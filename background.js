/* global MaibParse, MaibConvert, MaibRates */
"use strict";

const ROOT_ID = "maib-root";
const CACHE_KEY = "rates";
const CACHE_TTL_MS = 60 * 60 * 1000;
const TAB_TIMEOUT_MS = 25 * 1000;
const TAB_POLL_MS = 700;

// ---------------------------------------------------------------------------
// Rates: storage cache -> background fetch (uses maib.md cookies) -> hidden-ish
// tab that lets the Incapsula bot check run, then scrape it.

let inflight = null;

async function readCache() {
  const { [CACHE_KEY]: entry } = await browser.storage.local.get(CACHE_KEY);
  return entry && entry.rates ? entry : null;
}

async function getRates({ force = false } = {}) {
  const cached = await readCache();
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, stale: false };
  }
  if (!inflight) inflight = fetchFresh().finally(() => (inflight = null));
  try {
    const entry = { rates: await inflight, fetchedAt: Date.now() };
    await browser.storage.local.set({ [CACHE_KEY]: entry });
    return { ...entry, stale: false };
  } catch (e) {
    if (cached) return { ...cached, stale: true, error: e.message };
    throw e;
  }
}

async function fetchFresh() {
  let html = null;
  try {
    const res = await fetch(MaibRates.RATES_URL, { credentials: "include", cache: "no-store" });
    if (res.ok) html = await res.text();
  } catch (e) {
    console.warn("maib: direct fetch failed", e);
  }
  if (!html || !html.includes(MaibRates.PANES.cash)) {
    html = await fetchViaTab();
  }
  return MaibRates.parseRates(new DOMParser().parseFromString(html, "text/html"));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchViaTab() {
  const tab = await browser.tabs.create({ url: MaibRates.RATES_URL, active: false });
  try {
    const deadline = Date.now() + TAB_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(TAB_POLL_MS);
      let results;
      try {
        results = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: (id) => (document.getElementById(id) ? document.documentElement.outerHTML : null),
          args: [MaibRates.PANES.cash],
        });
      } catch (e) {
        continue; // Page still loading or mid-redirect.
      }
      const html = results && results[0] && results[0].result;
      if (html) return html;
    }
    throw new Error("maib.md did not load in time");
  } finally {
    browser.tabs.remove(tab.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Context menu, rebuilt every time it opens to match the selection.

const menuTitle = (s) => s.replace(/&/g, "&&");
const currencyLabel = (c) => `${c} · ${MaibConvert.CURRENCIES[c]}`;

function createMenu(props) {
  return browser.menus.create({ contexts: ["selection"], ...props });
}

async function resetMenus() {
  await browser.menus.removeAll();
  createMenu({ id: ROOT_ID, title: "Convert with maib", visible: false });
}

browser.runtime.onInstalled.addListener(resetMenus);
browser.runtime.onStartup.addListener(resetMenus);

function addTargets(parentId, src, codes) {
  for (const dst of codes) {
    if (dst !== src) createMenu({ id: `conv:${src}:${dst}`, parentId, title: currencyLabel(dst) });
  }
}

function addSources(parentId, idPrefix, codes, exclude) {
  for (const src of codes) {
    if (src === exclude) continue;
    const id = `${idPrefix}:${src}`;
    createMenu({ id, parentId, title: currencyLabel(src) });
    addTargets(id, src, codes);
  }
}

// Returns false if a newer menu opened while this one was being built.
async function rebuildMenu(selectionText, isCurrent = () => true) {
  const parsed = MaibParse.parseSelection(selectionText || "");
  const cached = await readCache().catch(() => null);
  const codes = MaibConvert.availableCurrencies(cached && cached.rates);
  if (!isCurrent()) return false;

  await browser.menus.removeAll();
  if (!parsed) {
    createMenu({ id: ROOT_ID, title: "Convert with maib", visible: false });
  } else if (parsed.currency && codes.includes(parsed.currency)) {
    const src = parsed.currency;
    createMenu({ id: ROOT_ID, title: menuTitle(`Convert ${parsed.text} ${src} to`) });
    addTargets(ROOT_ID, src, codes);
    createMenu({ id: "maib-sep", parentId: ROOT_ID, type: "separator" });
    createMenu({ id: "alt", parentId: ROOT_ID, title: "Treat as another currency" });
    addSources("alt", "alt", codes, src);
  } else {
    createMenu({ id: ROOT_ID, title: menuTitle(`Convert ${parsed.text} from`) });
    addSources(ROOT_ID, "src", codes, null);
  }
  return isCurrent();
}

let menuInstance = 0;

browser.menus.onShown.addListener(async (info) => {
  if (!info.contexts.includes("selection")) return;
  const instance = ++menuInstance;
  if (await rebuildMenu(info.selectionText, () => instance === menuInstance)) browser.menus.refresh();
});

browser.menus.onHidden.addListener(() => {
  menuInstance++;
});

function onMenuClicked(info, tab) {
  const m = /^conv:([A-Z]{3}):([A-Z]{3})$/.exec(String(info.menuItemId));
  if (!m) return;
  showConversion({
    request: { selection: info.selectionText || "", src: m[1], dst: m[2] },
    tab,
    frameId: info.frameId || 0,
    targetElementId: info.targetElementId,
  });
}

browser.menus.onClicked.addListener(onMenuClicked);

// ---------------------------------------------------------------------------
// Conversion results: floating box in the page, or a notification where
// content scripts can't run (PDF viewer, about: pages, addons.mozilla.org).

async function computeModel({ selection, src, dst }, { force = false } = {}) {
  const parsed = MaibParse.parseSelection(selection);
  if (!parsed) {
    return { title: "maib", readings: [], rateLines: [], error: "No number found in the selection" };
  }
  try {
    const { rates, fetchedAt, stale, error } = await getRates({ force });
    return MaibConvert.buildModel({ parsed, src, dst, rates, fetchedAt, stale, error: stale ? error : null });
  } catch (e) {
    return MaibConvert.buildModel({ parsed, src, dst, rates: null, error: e.message });
  }
}

async function showConversion({ request, tab, frameId, targetElementId }) {
  const parsed = MaibParse.parseSelection(request.selection);
  const title = parsed ? `${parsed.text} ${request.src} → ${request.dst}` : "maib";
  const send = (msg) => browser.tabs.sendMessage(tab.id, msg, { frameId });

  let inPage = false;
  if (tab && tab.id >= 0) {
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, files: ["content/box.js"] });
      await send({ type: "maib-open", title, request, targetElementId });
      inPage = true;
    } catch (e) {
      console.info("maib: can't show box in this page, using a notification", e);
    }
  }

  const model = await computeModel(request);
  if (inPage) {
    try {
      await send({ type: "maib-result", model });
      return;
    } catch (e) {
      console.info("maib: box went away, using a notification", e);
    }
  }
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon-96.png"),
    title: model.title,
    message: MaibConvert.modelToText(model),
  });
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "maib-refresh") return computeModel(msg.request, { force: true });
  return undefined;
});
