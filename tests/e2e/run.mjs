// End-to-end check in headless Firefox via WebDriver BiDi: installs the
// add-on temporarily, fetches live rates from several banks, checks the
// menus and settings, and renders the box in each language.
// Usage: node tests/e2e/run.mjs [outDir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), "cv-e2e"));
const FIREFOX = process.env.FIREFOX || ["/usr/bin/firefox-esr", "/usr/bin/firefox"].find((f) => fs.existsSync(f));
const PORT = 9337;
const ADDON_ID = "maib-currency-converter@gisterecis";
const UUID = "6d1e2b1a-7c4b-4f3e-9a51-0c2d6a3b9e11";
const EXT = `moz-extension://${UUID}`;

fs.mkdirSync(OUT, { recursive: true });

// The test page is served over HTTP: Firefox doesn't let add-ons script file:// pages.
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, "tests", path.normalize(new URL(req.url, "http://x").pathname).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 404 : 200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(err ? "not found" : data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PAGE = `http://127.0.0.1:${server.address().port}/manual.html`;
// activeTab is only granted by a real menu click, which the protocol can't
// make, so this test copy may also script the local test server.
const EXT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cv-ext-"));
const SKIP = new Set([".git", "node_modules", "dist", "release", "web-ext-artifacts"]);
fs.cpSync(ROOT, EXT_DIR, { recursive: true, filter: (src) => !SKIP.has(path.relative(ROOT, src).split(path.sep)[0]) });
const testManifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
testManifest.host_permissions.push("http://127.0.0.1/*");
fs.writeFileSync(path.join(EXT_DIR, "manifest.json"), JSON.stringify(testManifest));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cv-ff-"));
fs.writeFileSync(
  path.join(profile, "user.js"),
  [
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [ADDON_ID]: UUID }))});`,
    `user_pref("browser.shell.checkDefaultBrowser", false);`,
    `user_pref("datareporting.policy.dataSubmissionEnabled", false);`,
    `user_pref("layout.css.prefers-color-scheme.content-override", ${process.env.DARK ? 0 : 1});`,
  ].join("\n")
);

const ff = spawn(FIREFOX, ["--headless", "--remote-debugging-port", String(PORT), "--profile", profile, "--no-remote"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("Firefox did not start")), 30000);
  ff.stderr.on("data", (d) => {
    if (String(d).includes("WebDriver BiDi listening")) {
      clearTimeout(t);
      resolve();
    }
  });
});

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.type === "error" ? reject(new Error(`${msg.error}: ${msg.message}`)) : resolve(msg.result);
  }
};
const cmd = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(context, expression) {
  const r = await cmd("script.evaluate", {
    expression: `(async () => { ${expression} })()`,
    target: { context },
    awaitPromise: true,
    resultOwnership: "none",
  });
  if (r.type === "exception") throw new Error(r.exceptionDetails.text);
  return r.result && r.result.value;
}

async function shot(context, name) {
  const { data } = await cmd("browsingContext.captureScreenshot", { context });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log("screenshot:", file);
}

// Firefox 15x no longer lets WebDriver navigate a tab to moz-extension://,
// so open it from the browser window (needs MOZ_REMOTE_ALLOW_SYSTEM_ACCESS).
async function openExtensionPage(url, { closeOthers = false } = {}) {
  const { contexts: before } = await cmd("browsingContext.getTree", { maxDepth: 0 });
  const { contexts: windows } = await cmd("browsingContext.getTree", { maxDepth: 0, "moz:scope": "chrome" });
  await evaluate(
    windows[0].context,
    `const gBrowser = window.gBrowser;
     gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`
  );
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const { contexts } = await cmd("browsingContext.getTree", { maxDepth: 0 });
    const page = contexts.find((c) => c.url === url && !before.some((b) => b.context === c.context));
    if (page) {
      if (closeOthers) for (const b of before) await cmd("browsingContext.close", { context: b.context }).catch(() => {});
      return page.context;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`could not open ${url}`);
}

let failed = false;
const check = (cond, label, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed = true;
};

try {
  await cmd("session.new", { capabilities: {} });
  await cmd("webExtension.install", { extensionData: { type: "path", path: EXT_DIR } });
  const harness = await openExtensionPage(`${EXT}/tests/e2e/harness.html`, { closeOthers: true });

  const bgEval = (code) =>
    evaluate(harness, `const bg = await browser.runtime.getBackgroundPage(); ${code}`);
  const setSettings = (settings) => bgEval(`await bg.saveSettings(${JSON.stringify(settings)}); return true;`);

  // 1. Is a plain background fetch to maib blocked on a fresh profile?
  const direct = await evaluate(
    harness,
    `const r = await fetch("https://www.maib.md/ro/curs-valutar", {credentials: "include", cache: "no-store"});
     const t = await r.text(); return JSON.stringify({status: r.status, len: t.length, hasTable: t.includes("one-one-new")});`
  );
  console.log("direct maib fetch on fresh profile:", direct);

  // 2. Live rates from banks with different source types (HTML behind a bot
  //    check, JSON APIs, plain HTML, XML).
  await bgEval(`await browser.storage.local.clear(); return true;`);
  for (const [id, table] of [["maib", "cash"], ["maib", "card"], ["victoriabank", "online"], ["energbank", "card"], ["otp", "cash"], ["bnm", "official"]]) {
    const t0 = Date.now();
    const r = JSON.parse(await bgEval(`return JSON.stringify(await bg.BankRates.getRates(${JSON.stringify(id)}, {force: ${table === "cash" || table === "online" || table === "official"}}));`));
    const eur = r.rates && r.rates.tables[table] && r.rates.tables[table].EUR;
    check(eur && eur.buy > 0 && eur.sell > 0, `getRates ${id} ${table} EUR`, `${JSON.stringify(eur)} date ${r.rates && r.rates.date}, ${Date.now() - t0} ms`);
  }
  const tabsLeft = await evaluate(harness, `return (await browser.tabs.query({})).length;`);
  check(tabsLeft === 1, "no fetch tabs left open", `${tabsLeft} tab(s) open`);

  // 3. Force the background-tab fallback used when a bot check blocks the fetch.
  const viaTab = JSON.parse(await bgEval(
    `const req = bg.Banks.get("maib").requests()[0];
     const t0 = Date.now(); const html = await bg.BankRates.fetchViaTab(req);
     return JSON.stringify({ok: html.includes("one-one-new"), ms: Date.now() - t0, tabs: (await browser.tabs.query({})).length});`
  ));
  check(viaTab.ok && viaTab.tabs === 1, "tab fallback scrapes the page and closes its tab", JSON.stringify(viaTab));

  // 4. Menu structure for detected / undetected / non-numeric selections.
  const menu = JSON.parse(await bgEval(
    `const exists = async (id) => browser.menus.update(id, {}).then(() => true, () => false);
     const probe = async (sel, ids) => { await bg.rebuildMenu(sel); const o = {}; for (const id of ids) o[id] = await exists(id); return o; };
     return JSON.stringify({
       detected: await probe("1.234,56 €", ["cv-root", "conv:EUR:MDL", "conv:EUR:USD", "alt", "alt:USD", "conv:USD:GBP", "conv:EUR:EUR", "conv:EUR:RUB", "src:EUR", "cv-settings"]),
       undetected: await probe("1 250,50", ["cv-root", "src:EUR", "src:MDL", "conv:MDL:EUR", "conv:UAH:CHF", "alt", "cv-settings"]),
       text: await probe("hello", ["cv-root", "src:EUR", "conv:EUR:MDL", "cv-settings"]),
     });`
  ));
  const expectMenu = {
    detected: { "cv-root": true, "conv:EUR:MDL": true, "conv:EUR:USD": true, alt: true, "alt:USD": true, "conv:USD:GBP": true, "conv:EUR:EUR": false, "conv:EUR:RUB": false, "src:EUR": false, "cv-settings": true },
    undetected: { "cv-root": true, "src:EUR": true, "src:MDL": true, "conv:MDL:EUR": true, "conv:UAH:CHF": true, alt: false, "cv-settings": true },
    text: { "cv-root": true, "src:EUR": false, "conv:EUR:MDL": false, "cv-settings": false },
  };
  for (const k of Object.keys(expectMenu)) {
    check(JSON.stringify(menu[k]) === JSON.stringify(expectMenu[k]), `menu items for ${k} selection`, JSON.stringify(menu[k]));
  }
  // The menu only offers what the chosen bank quotes (ProCredit: EUR, USD).
  await setSettings({ bank: "procredit" });
  await bgEval(`await bg.BankRates.getRates("procredit"); return true;`);
  const pc = JSON.parse(await bgEval(
    `await bg.rebuildMenu("100 €"); const exists = async (id) => browser.menus.update(id, {}).then(() => true, () => false);
     return JSON.stringify({usd: await exists("conv:EUR:USD"), gbp: await exists("conv:EUR:GBP")});`
  ));
  check(pc.usd && !pc.gbp, "menu follows the selected bank's currencies", JSON.stringify(pc));
  // Any currency the bank quotes is detected, even if the menu only lists popular targets.
  await setSettings({ bank: "bnm" });
  const pln = JSON.parse(await bgEval(
    `await bg.rebuildMenu("250 PLN"); const exists = async (id) => browser.menus.update(id, {}).then(() => true, () => false);
     return JSON.stringify({mdl: await exists("conv:PLN:MDL"), eur: await exists("conv:PLN:EUR"), from: await exists("src:EUR")});`
  ));
  check(pln.mdl && pln.eur && !pln.from, "BNM: 250 PLN is detected as PLN", JSON.stringify(pln));
  await setSettings({ bank: "procredit" });

  // 5. Settings: language and bank, and a bank switch from the box is saved.
  const lang = JSON.parse(await bgEval(
    `const ro = await bg.optionsData(); await bg.saveSettings({lang: "ru"}); const ru = await bg.optionsData();
     await bg.saveSettings({lang: "bogus", bank: "nope"}); const kept = await bg.getSettings();
     return JSON.stringify({ro: ro.strings.optBank, ru: ru.strings.optBank, kept});`
  ));
  check(lang.ru === "Банк, курс которого вы используете" && lang.kept.lang === "ru" && lang.kept.bank === "procredit", "settings save and ignore bad values", JSON.stringify(lang));
  const switched = JSON.parse(await bgEval(
    `const m = await bg.convertFromBox({request: {selection: "100 EUR", src: "EUR", dst: "MDL", bank: "victoriabank"}});
     return JSON.stringify({bank: m.bank.id, saved: (await bg.getSettings()).bank, sections: m.readings[0].sections.map((s) => s.key), first: m.readings[0].sections[0].rows[0]});`
  ));
  check(switched.bank === "victoriabank" && switched.saved === "victoriabank" && switched.sections.join() === "cash,online", "bank switch from the box is converted and saved", JSON.stringify(switched));

  // 6. Render the box in a normal page: each language, a few banks.
  const { context: page } = await cmd("browsingContext.create", { type: "tab" });
  await cmd("browsingContext.navigate", { context: page, url: PAGE, wait: "complete" });
  await cmd("browsingContext.setViewport", { context: page, viewport: { width: 1000, height: 760 } });
  const inject = await bgEval(
    `const tab = (await browser.tabs.query({})).find((t) => t.url && t.url.startsWith(${JSON.stringify(PAGE)}));
     if (!tab) return "no test page tab among " + JSON.stringify((await browser.tabs.query({})).map((t) => t.url));
     try { await browser.scripting.executeScript({target: {tabId: tab.id, frameIds: [0]}, files: ["content/box.js"]}); return "ok"; }
     catch (e) { return String(e); }`
  );
  check(inject === "ok", "box script can be injected into the test page", inject);
  const cases = [
    ["1.234,56 €", "EUR", "MDL", { bank: "maib", lang: "ro" }, "Numerar la sucursale", "box-ro-maib.png"],
    ["1,234 EUR", "EUR", "USD", { bank: "maib", lang: "en" }, "Card operations", "box-en-ambiguous.png"],
    ["£ 99.99", "GBP", "EUR", { bank: "victoriabank", lang: "ru" }, "Онлайн", "box-ru-victoriabank.png"],
    ["7 500 lei", "MDL", "EUR", { bank: "bnm", lang: "ro" }, "Cursul oficial BNM", "box-ro-bnm.png"],
  ];
  for (const [text, src, dst, settings, expectText, file] of cases) {
    await setSettings(settings);
    await cmd("browsingContext.activate", { context: page });
    await evaluate(
      page,
      `const span = [...document.querySelectorAll("span")].find((s) => s.textContent === ${JSON.stringify(text)});
       span.scrollIntoView({block: "center"});
       const range = document.createRange(); range.selectNodeContents(span);
       const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);`
    );
    const ok = await bgEval(
      `const tab = (await browser.tabs.query({})).find((t) => t.url && t.url.startsWith(${JSON.stringify(PAGE)}));
       bg.onMenuClicked({menuItemId: "conv:${src}:${dst}", selectionText: ${JSON.stringify(text)}, frameId: 0}, tab);
       await new Promise((r) => setTimeout(r, 1500));
       const model = await bg.computeModel({selection: ${JSON.stringify(text)}, src: "${src}", dst: "${dst}"});
       return JSON.stringify(model);`
    );
    const model = JSON.parse(ok);
    const flat = JSON.stringify(model);
    check(flat.includes(expectText) && model.readings.length > 0 && !model.error, `model ${text} ${src}→${dst} (${settings.bank}, ${settings.lang})`, model.readings[0] && JSON.stringify(model.readings[0].sections[0]));
    const hasBox = await evaluate(page, `return !!document.querySelector("cv-converter-box");`);
    check(hasBox, `box element present for ${text}`);
    await shot(page, file);
  }

  // 6b. Keyboard shortcut: converts the selection without the menu.
  await setSettings({ bank: "maib", lang: "ro" });
  await evaluate(
    page,
    `const span = [...document.querySelectorAll("span")].find((s) => s.textContent === "1.234,56 €");
     const range = document.createRange(); range.selectNodeContents(span);
     const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);`
  );
  await evaluate(page, `document.querySelector("cv-converter-box")?.remove(); return true;`);
  const viaShortcut = await bgEval(
    `const tab = (await browser.tabs.query({})).find((t) => t.url && t.url.startsWith(${JSON.stringify(PAGE)}));
     await bg.convertSelectionInTab(tab); return true;`
  );
  const shortcutBox = await evaluate(page, `return !!document.querySelector("cv-converter-box");`);
  check(viaShortcut && shortcutBox, "shortcut opens the box for the selection");

  // 7. Esc closes the box.
  await cmd("input.performActions", {
    context: page,
    actions: [{ type: "key", id: "kb", actions: [{ type: "keyDown", value: "" }, { type: "keyUp", value: "" }] }],
  });
  const closed = await evaluate(page, `return !document.querySelector("cv-converter-box");`);
  check(closed, "Esc closes the box");

  // 7b. Toolbar popup (opened as a page).
  await bgEval(`await browser.storage.local.remove("popup:last"); return true;`);
  const popup = await openExtensionPage(`${EXT}/popup/popup.html`);
  let popupText = null;
  for (let i = 0; i < 50 && !popupText; i++) {
    popupText = await evaluate(popup, `const c = document.getElementById("app").shadowRoot && document.getElementById("app").shadowRoot.querySelector(".card");
      return c && !c.classList.contains("busy") && c.querySelector(".tile:not(.sk)") ? c.textContent : null;`);
    if (!popupText) await new Promise((r) => setTimeout(r, 200));
  }
  check(popupText && popupText.includes("Numerar la sucursale") && popupText.includes("1 EUR ="), "toolbar popup converts 100 EUR", popupText && popupText.slice(0, 80));
  // Firefox can't resize or screenshot extension pages over WebDriver; the Chrome run covers those.
  await cmd("browsingContext.close", { context: popup }).catch(() => {});

  // 8. Privileged pages can't host the box: result goes to a notification.
  await cmd("browsingContext.navigate", { context: page, url: "about:robots", wait: "complete" });
  const notes = JSON.parse(await bgEval(
    `const tab = (await browser.tabs.query({})).find((t) => !(t.url || "").startsWith("moz-extension:"));
     await bg.showConversion({request: {selection: "100 EUR", src: "EUR", dst: "MDL"}, tab, frameId: 0});
     return JSON.stringify(await browser.notifications.getAll());`
  ));
  const ids = Object.keys(notes);
  check(ids.length === 1 && /MDL/.test(notes[ids[0]].message), "notification fallback on about:robots", ids.length ? JSON.stringify(notes[ids[0]].message) : "none");
} catch (e) {
  console.error("ERROR", e);
  failed = true;
} finally {
  try { ws.close(); } catch {}
  ff.kill();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
