// End-to-end check in headless Firefox via WebDriver BiDi:
// installs the add-on temporarily, fetches live maib rates and renders the box.
// Usage: node tests/e2e/run.mjs [outDir]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), "maib-e2e"));
const FIREFOX = process.env.FIREFOX || "/usr/bin/firefox-esr";
const PORT = 9337;
const ADDON_ID = "maib-currency-converter@gisterecis";
const UUID = "6d1e2b1a-7c4b-4f3e-9a51-0c2d6a3b9e11";
const EXT = `moz-extension://${UUID}`;

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "maib-ff-"));
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

let failed = false;
const check = (cond, label, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed = true;
};

try {
  await cmd("session.new", { capabilities: {} });
  await cmd("webExtension.install", { extensionData: { type: "path", path: ROOT } });
  const { contexts } = await cmd("browsingContext.getTree", {});
  const harness = contexts[0].context;
  await cmd("browsingContext.navigate", { context: harness, url: `${EXT}/tests/e2e/harness.html`, wait: "complete" });

  // 1. Is a plain background fetch blocked on a fresh profile?
  const direct = await evaluate(
    harness,
    `const r = await fetch("https://www.maib.md/ro/curs-valutar", {credentials: "include", cache: "no-store"});
     const t = await r.text(); return JSON.stringify({status: r.status, len: t.length, hasTable: t.includes("one-one-new")});`
  );
  console.log("direct fetch on fresh profile:", direct);

  // 2. getRates() — falls back to a background tab when blocked.
  const t0 = Date.now();
  const rates = JSON.parse(
    await evaluate(
      harness,
      `const bg = await browser.runtime.getBackgroundPage();
       await browser.storage.local.clear();
       return JSON.stringify(await bg.getRates({force: true}));`
    )
  );
  check(rates.rates && rates.rates.cash && rates.rates.cash.EUR && rates.rates.cash.EUR.buy > 0, "getRates returns cash EUR",
    `${JSON.stringify(rates.rates.cash.EUR)} date ${rates.rates.date}, ${Date.now() - t0} ms`);
  check(rates.rates.card && rates.rates.card.USD && rates.rates.card.USD.sell > 0, "getRates returns card USD", JSON.stringify(rates.rates.card.USD));
  const tabsLeft = await evaluate(harness, `return (await browser.tabs.query({})).length;`);
  check(tabsLeft === 1, "fallback tab was closed", `${tabsLeft} tab(s) open`);

  // 3. After the fallback, a direct fetch should work (cookies set).
  const again = JSON.parse(await evaluate(
    harness,
    `const r = await fetch("https://www.maib.md/ro/curs-valutar", {credentials: "include", cache: "no-store"});
     const t = await r.text(); return JSON.stringify({len: t.length, hasTable: t.includes("one-one-new")});`
  ));
  check(again.hasTable, "direct fetch works after the challenge", JSON.stringify(again));

  // 3b. Force the background-tab fallback used when Incapsula blocks the fetch.
  const viaTab = JSON.parse(await evaluate(
    harness,
    `const bg = await browser.runtime.getBackgroundPage();
     const t0 = Date.now(); const html = await bg.fetchViaTab();
     return JSON.stringify({ok: html.includes("one-one-new"), ms: Date.now() - t0, tabs: (await browser.tabs.query({})).length});`
  ));
  check(viaTab.ok && viaTab.tabs === 1, "tab fallback scrapes the page and closes its tab", JSON.stringify(viaTab));

  // 3c. Menu structure for detected / undetected / non-numeric selections.
  const menu = JSON.parse(await evaluate(
    harness,
    `const bg = await browser.runtime.getBackgroundPage();
     const exists = async (id) => browser.menus.update(id, {}).then(() => true, () => false);
     const probe = async (sel, ids) => { await bg.rebuildMenu(sel); const o = {}; for (const id of ids) o[id] = await exists(id); return o; };
     return JSON.stringify({
       detected: await probe("1.234,56 €", ["maib-root", "conv:EUR:MDL", "conv:EUR:USD", "alt", "alt:USD", "conv:USD:GBP", "conv:EUR:EUR", "conv:EUR:RUB", "src:EUR"]),
       undetected: await probe("1 250,50", ["maib-root", "src:EUR", "src:MDL", "conv:MDL:EUR", "conv:UAH:CHF", "alt"]),
       text: await probe("hello", ["maib-root", "src:EUR", "conv:EUR:MDL"]),
     });`
  ));
  const expectMenu = {
    detected: { "maib-root": true, "conv:EUR:MDL": true, "conv:EUR:USD": true, alt: true, "alt:USD": true, "conv:USD:GBP": true, "conv:EUR:EUR": false, "conv:EUR:RUB": false, "src:EUR": false },
    undetected: { "maib-root": true, "src:EUR": true, "src:MDL": true, "conv:MDL:EUR": true, "conv:UAH:CHF": true, alt: false },
    text: { "maib-root": true, "src:EUR": false, "conv:EUR:MDL": false },
  };
  for (const k of Object.keys(expectMenu)) {
    check(JSON.stringify(menu[k]) === JSON.stringify(expectMenu[k]), `menu items for ${k} selection`, JSON.stringify(menu[k]));
  }

  // 4. Render the box in a normal page for a few selections.
  const { context: page } = await cmd("browsingContext.create", { type: "tab" });
  await cmd("browsingContext.navigate", { context: page, url: `file://${ROOT}/tests/manual.html`, wait: "complete" });
  await cmd("browsingContext.setViewport", { context: page, viewport: { width: 1000, height: 760 } });
  const cases = [
    ["1.234,56 €", "EUR", "MDL", "box-eur-mdl.png"],
    ["1,234 EUR", "EUR", "USD", "box-ambiguous.png"],
    ["£ 99.99", "GBP", "EUR", "box-gbp-eur.png"],
  ];
  for (const [text, src, dst, file] of cases) {
    await cmd("browsingContext.activate", { context: page });
    await evaluate(
      page,
      `const span = [...document.querySelectorAll("span")].find((s) => s.textContent === ${JSON.stringify(text)});
       span.scrollIntoView({block: "center"});
       const range = document.createRange(); range.selectNodeContents(span);
       const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);`
    );
    const ok = await evaluate(
      harness,
      `const bg = await browser.runtime.getBackgroundPage();
       const tab = (await browser.tabs.query({})).find((t) => t.url && t.url.startsWith("file:"));
       bg.onMenuClicked({menuItemId: "conv:${src}:${dst}", selectionText: ${JSON.stringify(text)}, frameId: 0}, tab);
       await new Promise((r) => setTimeout(r, 500));
       return !!tab;`
    );
    check(ok, `showConversion ${text} ${src}→${dst}`);
    await new Promise((r) => setTimeout(r, 300));
    const hasBox = await evaluate(page, `return !!document.querySelector("maib-converter-box");`);
    check(hasBox, `box element present for ${text}`);
    await shot(page, file);
  }

  // 5. Esc closes the box.
  await cmd("input.performActions", {
    context: page,
    actions: [{ type: "key", id: "kb", actions: [{ type: "keyDown", value: "" }, { type: "keyUp", value: "" }] }],
  });
  const closed = await evaluate(page, `return !document.querySelector("maib-converter-box");`);
  check(closed, "Esc closes the box");

  // 6. Privileged pages can't host the box: result goes to a notification.
  await cmd("browsingContext.navigate", { context: page, url: "about:robots", wait: "complete" });
  const notes = JSON.parse(await evaluate(
    harness,
    `const bg = await browser.runtime.getBackgroundPage();
     const tab = (await browser.tabs.query({})).find((t) => !(t.url || "").startsWith("moz-extension:"));
     await bg.showConversion({request: {selection: "100 EUR", src: "EUR", dst: "MDL"}, tab, frameId: 0});
     return JSON.stringify(await browser.notifications.getAll());`
  ));
  const ids = Object.keys(notes);
  check(ids.length === 1, "notification fallback on about:robots", ids.length ? JSON.stringify(notes[ids[0]].message) : "none");
} catch (e) {
  console.error("ERROR", e);
  failed = true;
} finally {
  try { ws.close(); } catch {}
  ff.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
