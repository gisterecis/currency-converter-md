// End-to-end check of the Chrome build in headless Chromium over the DevTools
// protocol: loads dist/chrome, fetches every bank's rates in the service
// worker, checks the static menu, renders the box and switches banks in it,
// and checks the notification fallback and the settings page.
// With --store it also saves the Chrome Web Store screenshots (1280×800) to
// store/screenshots/.
// Usage: node scripts/build.mjs && node tests/e2e/chrome.mjs [outDir] [--store]
import { execFileSync, spawn } from "node:child_process";
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
    // Headless Chromium says "HeadlessChrome", which bot checks treat differently from real users.
    "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
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

// The toolbar popup as a page, sized like the real one.
async function openPopup(extId) {
  const page = await openPage(`chrome-extension://${extId}/popup/popup.html`);
  const height = await evaluate(
    page.sessionId,
    `for (let i = 0; i < 50; i++) {
       const c = document.getElementById("app").shadowRoot && document.getElementById("app").shadowRoot.querySelector(".card");
       if (c && !c.classList.contains("busy") && c.querySelector(".tile:not(.sk)")) break;
       await new Promise((r) => setTimeout(r, 200));
     }
     return document.getElementById("app").getBoundingClientRect().height;`
  );
  await cmd("Emulation.setDeviceMetricsOverride", { width: 380, height: Math.ceil(Math.min(600, height)), deviceScaleFactor: 1, mobile: false }, page.sessionId);
  return page;
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
  const found = { host: null, shadow: null, bank: null, amount: null, head: null, tiles: [] };
  (function walk(n, inBox) {
    if (n.nodeName === "CV-CONVERTER-BOX") {
      found.host = n;
      found.shadow = (n.shadowRoots || [])[0] || null;
      inBox = true;
    }
    const attrs = n.attributes || [];
    const cls = attrs.includes("class") ? attrs[attrs.indexOf("class") + 1] : "";
    if (inBox && n.nodeName === "SELECT" && cls === "bank") found.bank = n;
    if (inBox && n.nodeName === "INPUT" && cls === "amount") found.amount = n;
    if (inBox && n.nodeName === "HEADER") found.head = n;
    if (inBox && n.nodeName === "BUTTON" && /^tile\b/.test(cls)) found.tiles.push(n);
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c, inBox);
  })(root, false);
  return found;
}

async function callOn(session, node, fn, ...values) {
  const { object } = await cmd("DOM.resolveNode", { backendNodeId: node.backendNodeId }, session);
  const r = await cmd("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn, arguments: values.map((value) => ({ value })), returnByValue: true }, session);
  return r.result.value;
}

// Text of the box once it shows results (not the loading skeleton), or null.
async function boxText(session) {
  const { shadow } = await boxNodes(session);
  if (!shadow) return null;
  return callOn(session, shadow, `function () {
    const card = this.querySelector(".card");
    return card && !card.classList.contains("busy") && card.querySelector(".tile:not(.sk), .alert") ? card.textContent : null;
  }`);
}

async function waitFor(fn, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    const v = await fn();
    if (v) return v;
  }
  return fn();
}

// A real mouse click (copying needs a user gesture).
async function clickNode(session, node, dx = 0, dy = 0) {
  const { model } = await cmd("DOM.getBoxModel", { backendNodeId: node.backendNodeId }, session);
  const [x1, y1, x2, , , y3] = model.border;
  const x = (x1 + x2) / 2 + dx;
  const y = (y1 + y3) / 2 + dy;
  for (const type of ["mousePressed", "mouseReleased"]) await cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, session);
  return { x, y };
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
    await sleep(300);
    return waitFor(() => boxText(session));
  };

  check(await selectText(page.sessionId, "1.234,56 €"), "selected 1.234,56 €");
  let text = await click(page.sessionId, findTab, "to:MDL", "1.234,56 €");
  check(text && text.includes("Numerar la sucursale") && text.includes("Operațiuni cu cardul") && text.includes("Vinzi EUR, primești") && text.includes("cel mai bun"), "box shows maib cash and card tiles in Romanian", text && text.slice(0, 200));
  await shot(page.sessionId, "chrome-box-ro-maib.png");

  const { bank: bankSelect } = await boxNodes(page.sessionId);
  check(!!bankSelect, "box has a bank picker");
  await callOn(page.sessionId, bankSelect, "function (v) { this.value = v; this.dispatchEvent(new Event('change')); }", "victoriabank");
  text = await waitFor(async () => {
    const t = await boxText(page.sessionId);
    return t && t.includes("Online / aplicație") ? t : null;
  });
  check(text && text.includes("Victoriabank") && text.includes("Online / aplicație"), "switching the bank in the box re-renders", text && text.slice(0, 160));
  check((await bgEval("return (await getSettings()).bank;")) === "victoriabank", "bank picked in the box is saved");
  await shot(page.sessionId, "chrome-box-ro-victoriabank.png");

  // Expected numbers come from the rates the extension fetched (they're live).
  const roMoney = (v) => new Intl.NumberFormat("ro-MD", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const cashBuy = (bank) => bgEval(`return (await BankRates.getRates(${JSON.stringify(bank)})).rates.tables.cash.EUR.buy;`);

  // Editing the amount in the box re-converts it.
  const vbTwoThousand = roMoney(2000 * (await cashBuy("victoriabank")));
  const { amount: amountInput } = await boxNodes(page.sessionId);
  await callOn(page.sessionId, amountInput, "function (v) { this.value = v; this.dispatchEvent(new Event('input')); }", "2 000");
  text = await waitFor(async () => {
    const t = await boxText(page.sessionId);
    return t && t.includes(vbTwoThousand) ? t : null;
  });
  check(!!text, "typing a new amount re-converts", `2 000 EUR → ${vbTwoThousand} MDL`);

  // Clicking a result copies it.
  await cmd("Browser.grantPermissions", { origin: ORIGIN, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  const { tiles } = await boxNodes(page.sessionId);
  await clickNode(page.sessionId, tiles[0]);
  const toast = await waitFor(async () => {
    const { shadow } = await boxNodes(page.sessionId);
    return callOn(page.sessionId, shadow, "function () { const t = this.querySelector('.toast.show'); return t && t.textContent; }");
  }, 3000);
  const clip = await evaluate(page.sessionId, "return navigator.clipboard.readText().catch((e) => 'error: ' + e.message);");
  check(toast === `Copiat: ${vbTwoThousand} MDL` && clip === vbTwoThousand, "clicking a result copies the number", `toast ${JSON.stringify(toast)}, clipboard ${JSON.stringify(clip)}`);

  // The header drags the box.
  const { head, host: boxHost } = await boxNodes(page.sessionId);
  const before = await callOn(page.sessionId, boxHost, "function () { return [parseFloat(this.style.left), parseFloat(this.style.top)]; }");
  const start = await clickNode(page.sessionId, head, -60, 0);
  await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", clickCount: 1 }, page.sessionId);
  await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + 150, y: start.y + 80, button: "left", buttons: 1 }, page.sessionId);
  await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + 150, y: start.y + 80, button: "left", clickCount: 1 }, page.sessionId);
  const after = await callOn(page.sessionId, boxHost, "function () { return [parseFloat(this.style.left), parseFloat(this.style.top)]; }");
  check(Math.abs(after[0] - before[0] - 150) < 2 && Math.abs(after[1] - before[1] - 80) < 2, "dragging the header moves the box", `${before} -> ${after}`);

  check(await selectText(page.sessionId, "1 250,50"), "selected 1 250,50");
  text = await click(page.sessionId, findTab, "to:EUR", "1 250,50");
  check(text && text.includes("nu a fost recunoscută"), "unknown currency: box asks to pick it", text && text.slice(0, 160));

  await setSettings({ lang: "ru" });
  check(await selectText(page.sessionId, "£ 99.99"), "selected £ 99.99");
  text = await click(page.sessionId, findTab, "to:EUR", "£ 99.99");
  check(text && text.includes("Наличные в отделениях") && text.includes("Продаёте GBP, получаете") && text.includes("1 GBP ="), "box in Russian", text && text.slice(0, 160));

  await setSettings({ lang: "en", bank: "maib" });
  check(await selectText(page.sessionId, "1,234 EUR"), "selected 1,234 EUR");
  text = await click(page.sessionId, findTab, "to:USD", "1,234 EUR");
  check(text && text.includes("both readings") && text.includes("1,234 EUR") && text.includes("1.234 EUR") && text.includes("Cash at branches"), "ambiguous amount offers both readings in English", text && text.slice(0, 160));
  await shot(page.sessionId, "chrome-box-en-ambiguous.png");

  // Keyboard shortcut: converts the selection without the menu.
  await setSettings({ lang: "ro", bank: "maib" });
  check(await selectText(page.sessionId, "7 500 lei"), "selected 7 500 lei");
  const lastForeign = await bgEval(`const tab = ${findTab}; await convertSelectionInTab(tab); return (await getSettings()).lastForeign;`);
  text = await waitFor(() => boxText(page.sessionId));
  check(text && text.includes(`1 ${lastForeign} =`) && text.includes("Vinzi MDL, primești"), "shortcut converts lei to the last foreign currency", `${lastForeign}: ${text && text.slice(0, 120)}`);

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
  check(optState.title === "Convertor valutar MD" && optState.bank === "maib" && optState.banks === 11 && optState.lang === "ro", "settings page renders in Romanian", JSON.stringify(optState));
  // Headless Chromium doesn't assign suggested shortcuts, so compare with what it reports.
  const shortcut = JSON.parse(await waitFor(() => evaluate(opts.sessionId, `const kbd = [...document.querySelectorAll("#shortcut kbd")].map((k) => k.textContent).join("+");
    const text = document.getElementById("shortcut").textContent;
    const real = ((await chrome.commands.getAll()).find((c) => c.name === "convert-selection") || {}).shortcut || "";
    return text ? JSON.stringify({ kbd, text, real }) : null;`), 3000));
  check(shortcut.real ? shortcut.kbd === shortcut.real : shortcut.text === "nesetată", "settings page shows the shortcut", JSON.stringify(shortcut));
  await shot(opts.sessionId, "chrome-settings-ro.png");
  await evaluate(opts.sessionId, `const s = document.getElementById("lang"); s.value = "en"; s.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 500)); return true;`);
  const optEn = await evaluate(opts.sessionId, `return document.getElementById("bank-label").textContent;`);
  check(optEn === "Bank whose rates you use", "settings page switches language", optEn);
  check((await bgEval("return (await getSettings()).lang;")) === "en", "language setting saved");

  // 8. Toolbar popup: remembers the last conversion, converts as you type.
  await setSettings({ lang: "ro", bank: "maib" });
  await bgEval(`await chrome.storage.local.remove("popup:last"); return true;`);
  const popup = await openPopup(extId);
  const popupText = () => evaluate(popup.sessionId, `const c = document.getElementById("app").shadowRoot.querySelector(".card");
    return c && !c.classList.contains("busy") && c.querySelector(".tile:not(.sk)") ? c.textContent : null;`);
  const maibBuy = await cashBuy("maib");
  text = await waitFor(popupText);
  check(text && text.includes("Numerar la sucursale") && text.includes(`1 EUR = ${roMoney(maibBuy)} MDL`), "popup converts 100 EUR at maib", text && text.slice(0, 120));
  await evaluate(popup.sessionId, `const i = document.getElementById("app").shadowRoot.querySelector(".amount"); i.value = "250"; i.dispatchEvent(new Event("input")); return true;`);
  text = await waitFor(async () => {
    const t = await popupText();
    return t && t.includes(roMoney(250 * maibBuy)) ? t : null;
  });
  const saved = JSON.parse(await bgEval(`return JSON.stringify((await chrome.storage.local.get("popup:last"))["popup:last"]);`));
  check(!!text && saved.selection === "250" && saved.src === "EUR" && saved.dst === "MDL", "popup re-converts as you type and remembers it", JSON.stringify(saved));
  await shot(popup.sessionId, "chrome-popup-ro.png");

  // 9. Store screenshots per language: two conversions on the demo shop page,
  //    and the toolbar popup composited over it where Chrome opens it.
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
    const popupExample = { ro: ["1 500", "USD", "MDL"], en: ["1 500", "USD", "MDL"], ru: ["2 000", "EUR", "MDL"] };
    for (const lang of ["ro", "en", "ru"]) {
      for (const [i, [bank, amount, item]] of [[0, shots[0]], [1, lang === "ru" ? shots[2] : shots[1]]]) {
        await setSettings({ lang, bank });
        check(await selectText(demo.sessionId, amount), `demo: selected ${amount}`);
        const t = await click(demo.sessionId, demoTab, item, amount);
        check(t && !/Nu am putut|Couldn't|Не удалось/.test(t), `demo box ${lang} ${bank}`, t && t.slice(0, 60));
        await shot(demo.sessionId, `${lang}-${i + 1}.png`, dir);
      }
      await evaluate(demo.sessionId, `document.querySelector("cv-converter-box")?.remove(); getSelection().removeAllRanges(); return true;`);
      await shot(demo.sessionId, "demo-plain.png", OUT);
      const [selection, from, to] = popupExample[lang];
      await setSettings({ lang, bank: "victoriabank" });
      await bgEval(`await chrome.storage.local.set({"popup:last": ${JSON.stringify({ selection, src: from, dst: to })}}); return true;`);
      const pop = await openPopup(extId);
      await evaluate(pop.sessionId, `document.getElementById("app").shadowRoot.activeElement?.blur(); return true;`);
      await shot(pop.sessionId, "popup.png", OUT);
      await cmd("Target.closeTarget", { targetId: pop.targetId });
      await cmd("Target.activateTarget", { targetId: demo.targetId });
      execFileSync("convert", [
        path.join(OUT, "demo-plain.png"),
        "(", path.join(OUT, "popup.png"), "-bordercolor", "#cfd6de", "-border", "1",
        "(", "+clone", "-background", "#101828", "-shadow", "28x14+0+10", ")", "+swap", "-background", "none", "-layers", "merge", "+repage", ")",
        "-gravity", "northeast", "-geometry", "+28+0", "-composite", path.join(dir, `${lang}-3.png`),
      ]);
      console.log("screenshot:", path.join(dir, `${lang}-3.png`));
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
