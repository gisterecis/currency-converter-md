// Fetches and caches one bank's rates: storage cache -> background fetch
// (without cookies, except for sites behind a bot check, whose check cookie
// lets the fetch through) -> for those sites, a background tab that lets the
// check run, then reads the page.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;
  const { RateError } = Scrape;

  const CACHE_TTL_MS = 60 * 60 * 1000;
  const TAB_TIMEOUT_MS = 25 * 1000;
  const TAB_POLL_MS = 700;
  // Imperva's hard block ("Request unsuccessful. Incapsula incident ID: …"),
  // unlike its usual challenge, doesn't clear by itself in a background tab.
  // Once the tab has shown it this long, give up instead of waiting for the timeout.
  const HARD_BLOCK = "Incapsula incident ID";
  const HARD_BLOCK_GRACE_MS = 5 * 1000;

  const ext = () => root.Ext.api;
  const cacheKey = (id) => `rates:${id}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const inflight = new Map();

  async function readCache(id) {
    const key = cacheKey(id);
    const { [key]: entry } = await ext().storage.local.get(key);
    return entry && entry.rates ? entry : null;
  }

  // -> { rates, fetchedAt, stale, error }. Throws only when there is nothing cached.
  async function getRates(bankId, { force = false } = {}) {
    const bank = Banks.get(bankId);
    if (!bank) throw new RateError("unknownBank", bankId);
    const cached = await readCache(bank.id).catch(() => null);
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached, stale: false, error: null };
    }
    if (!inflight.has(bank.id)) inflight.set(bank.id, fetchFresh(bank).finally(() => inflight.delete(bank.id)));
    try {
      const entry = { rates: await inflight.get(bank.id), fetchedAt: Date.now() };
      await ext().storage.local.set({ [cacheKey(bank.id)]: entry });
      return { ...entry, stale: false, error: null };
    } catch (e) {
      if (cached) return { ...cached, stale: true, error: errorInfo(e) };
      throw e;
    }
  }

  const errorInfo = (e) => ({ code: (e && e.code) || "generic", detail: (e && (e.detail || e.message)) || String(e) });

  async function fetchOne(req, { cookies = false } = {}) {
    let res;
    try {
      res = await fetch(req.url, { credentials: cookies ? "include" : "omit", cache: "no-store" });
    } catch (e) {
      throw new RateError("network", e.message);
    }
    // 571 is ProCredit's rate limit.
    if (res.status === 429 || res.status === 571) throw new RateError("busy", String(res.status), { status: res.status });
    if (!res.ok) throw new RateError("http", String(res.status), { status: res.status });
    if (req.type === "json") {
      try {
        return await res.json();
      } catch (e) {
        throw Scrape.layoutError("response is not JSON");
      }
    }
    const body = await res.text();
    if (req.marker && !body.includes(req.marker)) throw new RateError("blocked", req.url);
    return body;
  }

  async function fetchFresh(bank) {
    const cookies = !!bank.tabFallback;
    const get = async (req) => {
      try {
        return await fetchOne(req, { cookies }).catch((e) => {
          // Imperva answers some requests with a cookie-setting redirect that
          // loops until the cookies stick; the second try usually gets the page.
          if (e.code !== "network" && e.code !== "blocked") throw e;
          return fetchOne(req, { cookies });
        });
      } catch (e) {
        if (!bank.tabFallback || req.type === "json" || e.code === "busy") throw e;
        console.info(`${bank.id}: direct fetch failed (${e.message}), trying a background tab`);
        return fetchViaTab(req);
      }
    };
    const bodies = bank.load ? await bank.load(get, bank) : await Promise.all(bank.requests().map(get));
    const rates = bank.parse(bodies);
    if (!Object.values(rates.tables || {}).some(Scrape.hasRates)) throw Scrape.layoutError("no rates found");
    return rates;
  }

  async function fetchViaTab(req) {
    const tab = await ext().tabs.create({ url: req.url, active: false });
    try {
      const start = Date.now();
      while (Date.now() - start < TAB_TIMEOUT_MS) {
        await sleep(TAB_POLL_MS);
        let results;
        try {
          results = await ext().scripting.executeScript({
            target: { tabId: tab.id },
            func: (marker, block) => {
              const html = document.documentElement.outerHTML;
              return html.includes(marker) ? { html } : { blocked: html.includes(block) };
            },
            args: [req.marker, HARD_BLOCK],
          });
        } catch (e) {
          continue; // Page still loading or mid-redirect.
        }
        const page = (results && results[0] && results[0].result) || {};
        if (page.html) return page.html;
        if (page.blocked && Date.now() - start >= HARD_BLOCK_GRACE_MS) throw new RateError("blocked", req.url);
      }
      throw new RateError("timeout", req.url);
    } finally {
      ext().tabs.remove(tab.id).catch(() => {});
    }
  }

  const api = { CACHE_TTL_MS, cacheKey, readCache, getRates, errorInfo, fetchFresh, fetchViaTab };
  root.BankRates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
