// End-to-end check of the Chrome build in headless Chromium over the DevTools
// protocol: loads dist/chrome, fetches every bank's rates in the service
// worker, checks the static menu, renders the box and switches banks in it,
// and checks the notification fallback and the settings page.
// With --store it also saves the Chrome Web Store screenshots (1280×800) to
// store/screenshots/.
// Usage: node scripts/build.mjs && node tests/e2e/chrome.mjs [outDir] [--store]
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const STORE = args.includes("--store");
const OUT = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(os.tmpdir(), "cv-e2e-chrome"));
const CHROMIUM = process.env.CHROMIUM || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((f) => fs.existsSync(f));
const BUILD = path.join(ROOT, "dist", "chrome");
if (!fs.existsSync(path.join(BUILD, "manifest.json"))) throw new Error("run node scripts/build.mjs first");

// activeTab is only granted by a real menu click, which the protocol can't
// make, so this test copy may also script the local test server.
const EXT = fs.mkdtempSync(path.join(os.tmpdir(), "cv-ext-"));
fs.cpSync(BUILD, EXT, { recursive: true });
const testManifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
testManifest.host_permissions.push("http://127.0.0.1/*");
fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(testManifest));

fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((req, res) => {
  const rel = path.normalize(new URL(req.url, "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    res.writeHead(err ? 404 : 200, { "Content-Type": rel.endsWith(".png") ? "image/png" : "text/html; charset=utf-8" });
    res.end(err ? "not found" : data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const PAGE = `${ORIGIN}/tests/manual.html`;
const DEMO = `${ORIGIN}/store/demo.html`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cv-chrome-"));
const chrome = spawn(
  CHROMIUM,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=en-US",
    "--window-size=1280,800",
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);
const wsUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("Chromium did not start")), 30000);
  chrome.stderr.on("data", (d) => {
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d));
    if (m) {
      clearTimeout(t);
      resolve(m[1]);
    }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ""}`)) : resolve(msg.result);
  }
};
const cmd = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(session, expression) {
  const r = await cmd("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
}

async function openPage(url) {
  const { targetId } = await cmd("Target.createTarget", { url });
  const { sessionId } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  await cmd("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  for (let i = 0; i < 50; i++) {
    const state = await evaluate(sessionId, "return document.readyState;").catch(() => "");
    if (state === "complete") break;
    await sleep(100);
  }
  return { targetId, sessionId };
}

async function shot(session, name, dir = OUT) {
  fs.mkdirSync(dir, { recursive: true });
  const { data } = await cmd("Page.captureScreenshot", { format: "png" }, session);
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log("screenshot:", file);
}

// The box's shadow root is closed; the protocol can still see inside it.
async function boxNodes(session) {
  const { root } = await cmd("DOM.getDocument", { depth: -1, pierce: true }, session);
  const found = { host: null, shadow: null, bank: null };
  (function walk(n, inBox) {
    if (n.nodeName === "CV-CONVERTER-BOX") {
      found.host = n;
      found.shadow = (n.shadowRoots || [])[0] || null;
      inBox = true;
    }
    if (inBox && n.nodeName === "SELECT") {
      const attrs = n.attributes || [];
      const cls = attrs[attrs.indexOf("class") + 1];
      if (attrs.includes("class") && cls === "bank") found.bank = n;
    }
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c, inBox);
  })(root, false);
  return found;
}

async function callOn(session, node, fn, ...values) {
  const { object } = await cmd("DOM.resolveNode", { backendNodeId: node.backendNodeId }, session);
  const r = await cmd("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn, arguments: values.map((value) => ({ value })), returnByValue: true }, session);
  return r.result.value;
}

async function boxText(session) {
  const { shadow } = await boxNodes(session);
  return shadow ? callOn(session, shadow, "function () { return this.textContent; }") : null;
}

async function selectText(session, text) {
  return evaluate(
    session,
    `const el = [...document.querySelectorAll("span, b")].find((s) => s.textContent === ${JSON.stringify(text)});
     if (!el) return false;
     el.scrollIntoView({block: "center"});
     const range = document.createRange(); range.selectNodeContents(el);
     const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
     return true;`
  );
}

let failed = false;
const check = (cond, label, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed = true;
};

try {
  // 1. The service worker starts and exposes the background functions.
  let sw = null;
  for (let i = 0; i < 100 && !sw; i++) {
    const { targetInfos } = await cmd("Target.getTargets");
    sw = targetInfos.find((t) => t.type === "service_worker" && /^chrome-extension:\/\/[a-p]{32}\/sw\.js$/.test(t.url));
    if (!sw) await sleep(100);
  }
  check(!!sw, "service worker is running", sw && sw.url);
  const extId = new URL(sw.url).host;
  const { sessionId: bg } = await cmd("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
  const bgEval = (code) => evaluate(bg, code);
  const setSettings = (s) => bgEval(`await saveSettings(${JSON.stringify(s)}); return true;`);
  const menuExists = (ids) =>
    bgEval(`const out = {};
      for (const id of ${JSON.stringify(ids)}) out[id] = await new Promise((r) => chrome.contextMenus.update(id, {}, () => r(!chrome.runtime.lastError)));
      return JSON.stringify(out);`).then(JSON.parse);

  check((await bgEval("return typeof DOMParser;")) === "undefined", "service worker has no DOMParser (adapters must not need it)");

  // 2. Every bank, live, from the service worker.
  await bgEval("await chrome.storage.local.clear(); return true;");
  for (const id of await bgEval("return Banks.ORDER;")) {
    const t0 = Date.now();
    const r = JSON.parse(await bgEval(`try { return JSON.stringify(await BankRates.getRates(${JSON.stringify(id)}, {force: true})); } catch (e) { return JSON.stringify({error: e.message}); }`));
    const tables = r.rates ? Object.entries(r.rates.tables).map(([k, t]) => `${k}:${Object.keys(t).length}`).join(" ") : r.error;
    const eur = r.rates && Object.values(r.rates.tables).map((t) => t.EUR).find(Boolean);
    check(eur && eur.buy > 0 && eur.sell > 0, `getRates ${id}`, `${tables} EUR ${JSON.stringify(eur)} ${r.rates ? r.rates.date : ""} (${Date.now() - t0} ms)`);
  }
  const tabsLeft = await bgEval("return (await chrome.tabs.query({})).length;");
  check(tabsLeft <= 1, "no fetch tabs left open", `${tabsLeft} tab(s)`);

  // 3. Static menu, rebuilt for the chosen bank's currencies.
  await setSettings({ bank: "maib", lang: "ro" });
  await bgEval("await buildStaticMenu(); return true;");
  const maibMenu = await menuExists(["cv-root", "to:MDL", "to:EUR", "to:GBP", "to:UAH", "cv-settings", "conv:EUR:MDL"]);
  check(JSON.stringify(maibMenu) === JSON.stringify({ "cv-root": true, "to:MDL": true, "to:EUR": true, "to:GBP": true, "to:UAH": true, "cv-settings": true, "conv:EUR:MDL": false }), "static menu for maib", JSON.stringify(maibMenu));
  await setSettings({ bank: "procredit" });
  await sleep(800); // storage.onChanged rebuilds the menu.
  const pcMenu = await menuExists(["to:EUR", "to:USD", "to:GBP"]);
  check(pcMenu["to:EUR"] && pcMenu["to:USD"] && !pcMenu["to:GBP"], "menu follows the bank setting", JSON.stringify(pcMenu));

  // 4. Source currency for the static menu: detected, or guessed.
  const src = JSON.parse(await bgEval(
    `const a = await computeModel({selection: "1.234,56 €", src: null, dst: "MDL", bank: "maib"});
     const b = await computeModel({selection: "1 250,50", src: null, dst: "MDL", bank: "maib"});
     const c = await computeModel({selection: "1 250,50", src: null, dst: "EUR", bank: "maib"});
     return JSON.stringify([[a.request.src, a.srcGuessed], [b.request.src, b.srcGuessed], [c.request.src, c.srcGuessed]]);`
  ));
  check(JSON.stringify(src) === JSON.stringify([["EUR", false], ["EUR", true], ["MDL", true]]), "source currency detected or guessed", JSON.stringify(src));

  // 5. The box in a normal page, and switching banks inside it.
  await setSettings({ bank: "maib", lang: "ro" });
  const page = await openPage(PAGE);
  const findTab = `(await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(${JSON.stringify(PAGE)}))`;
  const click = async (session, findTabExpr, menuItemId, text) => {
    await bgEval(`const tab = ${findTabExpr}; onMenuClicked({menuItemId: ${JSON.stringify(menuItemId)}, selectionText: ${JSON.stringify(text)}, frameId: 0}, tab); return true;`);
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const t = await boxText(session);
      if (t && !/Se încarcă|Fetching|Загружаем/.test(t)) return t;
    }
    return boxText(session);
  };

  check(await selectText(page.sessionId, "1.234,56 €"), "selected 1.234,56 €");
  let text = await click(page.sessionId, findTab, "to:MDL", "1.234,56 €");
  check(text && text.includes("Numerar la sucursale") && text.includes("Vinzi 1.234,56 EUR, primești") && text.includes("MDL"), "box shows maib cash and card in Romanian", text && text.slice(0, 160));
  await shot(page.sessionId, "chrome-box-ro-maib.png");

  const { bank: bankSelect } = await boxNodes(page.sessionId);
  check(!!bankSelect, "box has a bank picker");
  await callOn(page.sessionId, bankSelect, "function (v) { this.value = v; this.dispatchEvent(new Event('change')); }", "victoriabank");
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    text = await boxText(page.sessionId);
    if (text && text.includes("Online / aplicație")) break;
  }
  check(text && text.includes("Victoriabank") && text.includes("Online / aplicație"), "switching the bank in the box re-renders", text && text.slice(0, 160));
  check((await bgEval("return (await getSettings()).bank;")) === "victoriabank", "bank picked in the box is saved");
  await shot(page.sessionId, "chrome-box-ro-victoriabank.png");

  check(await selectText(page.sessionId, "1 250,50"), "selected 1 250,50");
  text = await click(page.sessionId, findTab, "to:EUR", "1 250,50");
  check(text && text.includes("nu a fost recunoscută"), "unknown currency: box asks to pick it", text && text.slice(0, 160));

  await setSettings({ lang: "ru" });
  check(await selectText(page.sessionId, "£ 99.99"), "selected £ 99.99");
  text = await click(page.sessionId, findTab, "to:EUR", "£ 99.99");
  check(text && text.includes("Наличные в отделениях") && text.includes("Продаёте 99,99 GBP"), "box in Russian", text && text.slice(0, 160));

  await setSettings({ lang: "en", bank: "maib" });
  check(await selectText(page.sessionId, "1,234 EUR"), "selected 1,234 EUR");
  text = await click(page.sessionId, findTab, "to:USD", "1,234 EUR");
  check(text && text.includes("both readings") && text.includes("Cash at branches"), "ambiguous amount shows both readings in English", text && text.slice(0, 160));
  await shot(page.sessionId, "chrome-box-en-ambiguous.png");

  // 6. Pages Chrome doesn't let extensions script: notification instead.
  const notes = JSON.parse(await bgEval(
    `const tab = await chrome.tabs.create({url: "chrome://version", active: true});
     await new Promise((r) => setTimeout(r, 800));
     await showConversion({request: {selection: "100 EUR", src: null, dst: "MDL"}, tab, frameId: 0});
     const all = await new Promise((r) => chrome.notifications.getAll(r));
     await chrome.tabs.remove(tab.id);
     return JSON.stringify(all);`
  ));
  const noteIds = Object.keys(notes);
  check(noteIds.length === 1, "notification fallback on chrome://version", JSON.stringify(notes));

  // 7. Settings page.
  await setSettings({ lang: "ro", bank: "maib" });
  const opts = await openPage(`chrome-extension://${extId}/options/options.html`);
  await sleep(500);
  const optState = JSON.parse(await evaluate(opts.sessionId, `return JSON.stringify({title: document.getElementById("title").textContent, bank: document.getElementById("bank").value, banks: document.getElementById("bank").options.length, lang: document.getElementById("lang").value});`));
  check(optState.title === "Setări · Convertor valutar MD" && optState.bank === "maib" && optState.banks === 11 && optState.lang === "ro", "settings page renders in Romanian", JSON.stringify(optState));
  await evaluate(opts.sessionId, `const s = document.getElementById("lang"); s.value = "en"; s.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 500)); return true;`);
  const optEn = await evaluate(opts.sessionId, `return document.getElementById("bank-label").textContent;`);
  check(optEn === "Bank whose rates you use", "settings page switches language", optEn);
  check((await bgEval("return (await getSettings()).lang;")) === "en", "language setting saved");

  // 8. Store screenshots: two conversions on the demo shop page per language.
  if (STORE) {
    const dir = path.join(ROOT, "store", "screenshots");
    fs.rmSync(dir, { recursive: true, force: true });
    const demo = await openPage(DEMO);
    const demoTab = `(await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(${JSON.stringify(DEMO)}))`;
    const shots = [
      ["maib", "1.299,00 €", "to:MDL"],
      ["victoriabank", "$849.99", "to:MDL"],
      ["micb", "24 990 lei", "to:EUR"],
    ];
    for (const lang of ["ro", "en", "ru"]) {
      for (const [i, [bank, amount, item]] of [[0, shots[0]], [1, lang === "ru" ? shots[2] : shots[1]]]) {
        await setSettings({ lang, bank });
        check(await selectText(demo.sessionId, amount), `demo: selected ${amount}`);
        const t = await click(demo.sessionId, demoTab, item, amount);
        check(t && !/Nu am putut|Couldn't|Не удалось/.test(t), `demo box ${lang} ${bank}`, t && t.slice(0, 100));
        await shot(demo.sessionId, `${lang}-${i + 1}.png`, dir);
      }
    }
  }
} catch (e) {
  console.error("ERROR", e);
  failed = true;
} finally {
  try {
    ws.close();
  } catch {}
  chrome.kill();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(EXT, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
