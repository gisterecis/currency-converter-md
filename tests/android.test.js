const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT, manifest, messages } = require("./helpers.js");

// Objects from the vm context have its own Array and Object prototypes.
const plain = (v) => JSON.parse(JSON.stringify(v));

// Runs the real background scripts against a stand-in for the extension API.
// Firefox for Android has no menus and no commands; desktop has both.
// `state.allowed`: the optional access to every site; `state.selection`: what's
// selected in the current tab.
function background({ menus = false, allowed = false, selection = "" } = {}) {
  const state = { allowed, selection };
  const calls = { registered: [], injected: [], sent: [] };
  const listeners = {};
  const event = (name) => ({ addListener: (f) => (listeners[name] = listeners[name] || []).push(f) });
  const store = { bank: "bnm" }; // No background-tab fallback, which this stand-in can't do.
  const area = {
    get: async (q) =>
      typeof q === "string" ? { [q]: store[q] } : Object.fromEntries(Object.entries(q).map(([k, v]) => [k, k in store ? store[k] : v])),
    set: async (o) => void Object.assign(store, o),
    remove: async () => {},
  };
  const browser = {
    runtime: {
      onInstalled: event("installed"),
      onStartup: event("startup"),
      onMessage: event("message"),
      getURL: (p) => `moz-extension://test/${p}`,
      openOptionsPage: async () => {},
    },
    storage: { sync: area, local: area, onChanged: event("storageChanged") },
    i18n: { getUILanguage: () => "ro" },
    permissions: { contains: async () => state.allowed, onAdded: event("permissionAdded"), onRemoved: event("permissionRemoved") },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => calls.registered.filter((s) => ids.includes(s.id)),
      registerContentScripts: async (scripts) => void calls.registered.push(...plain(scripts)),
      unregisterContentScripts: async ({ ids }) => void (calls.registered = calls.registered.filter((s) => !ids.includes(s.id))),
      // Files are recorded; a function reads the selection.
      executeScript: async (options) => {
        if (options.func) return [{ frameId: 0, result: state.selection }];
        calls.injected.push(plain(options));
        return [];
      },
    },
    tabs: { query: async () => [{ id: 7, url: "https://example.md/" }], sendMessage: async (tabId, msg) => (calls.sent.push(plain(msg)), true) },
    notifications: { create: async () => "" },
    action: {},
  };
  if (menus) {
    browser.menus = { create: () => {}, removeAll: async () => {}, refresh: () => {}, onShown: event("shown"), onHidden: event("hidden"), onClicked: event("clicked") };
    browser.commands = { onCommand: event("command") };
  }
  // Locale files load from the package; the banks are offline.
  const fetch = async (url) => {
    const file = /^moz-extension:\/\/test\/(.+)$/.exec(url);
    if (!file) throw new TypeError("offline");
    const text = fs.readFileSync(path.join(ROOT, file[1]), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  };
  const quiet = { log() {}, info() {}, warn() {}, error: console.error };
  const context = vm.createContext({ browser, fetch, console: quiet, setTimeout, clearTimeout, URL, AbortController, TextDecoder });
  for (const s of manifest.background.scripts) vm.runInContext(fs.readFileSync(path.join(ROOT, s), "utf8"), context, { filename: s });

  const send = (msg, sender = {}) =>
    new Promise((resolve) => {
      if (!listeners.message.map((f) => f(msg, sender, resolve)).includes(true)) resolve(undefined);
    });
  const fire = (name) => (listeners[name] || []).forEach((f) => f({ reason: "install" }));
  return { state, calls, listeners, send, fire };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

async function until(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), "timed out");
}

test("Android: the background loads without menus or commands and answers the popup", async () => {
  const bg = background();
  const data = await bg.send({ type: "cv-popup-data" });
  assert.equal(data.lang, "ro");
  assert.equal(data.strings.appName, messages("ro").appName.message);
  assert.deepEqual(plain(data.offer), { text: messages("ro").chipOffer.message, button: messages("ro").chipTurnOn.message });
  assert.equal(data.selection, undefined, "nothing selected");
});

test("Android: the popup starts from the amount selected in the page", async () => {
  const bg = background({ selection: " 1.234,56 € " });
  assert.deepEqual(plain((await bg.send({ type: "cv-popup-data" })).selection), { selection: "1.234,56 €", src: "EUR", dst: "MDL" });
  // No currency: to the last foreign currency, from lei.
  bg.state.selection = "1 250,50";
  assert.deepEqual(plain((await bg.send({ type: "cv-popup-data" })).selection), { selection: "1 250,50", src: "MDL", dst: "EUR" });
  bg.state.selection = "hello";
  assert.equal((await bg.send({ type: "cv-popup-data" })).selection, undefined);
});

test("Android: no selection button until access to every site is allowed", async () => {
  const bg = background();
  bg.fire("installed");
  bg.fire("startup");
  await settle();
  assert.equal(bg.calls.registered.length, 0);
  assert.equal(bg.calls.injected.length, 0, "nothing runs in pages");
});

test("Android: allowing every site registers the button and adds it to open tabs; revoking removes it", async () => {
  const bg = background();
  bg.state.allowed = true;
  bg.fire("permissionAdded");
  await until(() => bg.calls.registered.length && bg.calls.injected.length);
  const [chip] = bg.calls.registered;
  assert.deepEqual(chip.js, ["lib/parse.js", "content/chip.js"]);
  assert.deepEqual(chip.matches, manifest.optional_host_permissions);
  for (const f of chip.js) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.deepEqual(bg.calls.injected[0], { target: { tabId: 7 }, files: chip.js });

  // Startup keeps it; an update replaces it. Either way there's one.
  bg.fire("startup");
  bg.fire("installed");
  await settle();
  assert.equal(bg.calls.registered.length, 1);

  bg.state.allowed = false;
  bg.fire("permissionRemoved");
  await until(() => bg.calls.registered.length === 0);
});

test("Android: tapping the button converts the selection in its tab", async () => {
  const bg = background();
  const tab = { id: 7, url: "https://example.md/" };
  assert.equal(await bg.send({ type: "cv-chip", selection: "1.234,56 €" }, { tab, frameId: 0 }), true);
  assert.deepEqual(bg.calls.injected.at(-1), { target: { tabId: 7, frameIds: [0] }, files: ["lib/view.js", "content/box.js"] });
  const [open, result] = bg.calls.sent;
  assert.equal(open.type, "cv-open");
  assert.deepEqual(open.request, { selection: "1.234,56 €", src: "EUR", dst: "MDL" });
  assert.equal(result.type, "cv-result");

  // Lei go to the last foreign currency.
  await bg.send({ type: "cv-chip", selection: "7 500 lei" }, { tab, frameId: 0 });
  assert.deepEqual(bg.calls.sent.at(-2).request, { selection: "7 500 lei", src: "MDL", dst: "EUR" });

  assert.equal(await bg.send({ type: "cv-chip", selection: "hello" }, { tab, frameId: 0 }), false);
  assert.equal(await bg.send({ type: "cv-chip", selection: "100 €" }, {}), undefined, "only from a page");
});

test("Android: the settings page describes the button, not right-click", async () => {
  const android = await background().send({ type: "cv-options-data" });
  assert.equal(android.strings.optIntro, messages("ro").optIntroTouch.message);
  const desktop = await background({ menus: true }).send({ type: "cv-options-data" });
  assert.equal(desktop.strings.optIntro, messages("ro").optIntro.message);
});

test("desktop: menus instead of the selection button, and the popup as before", async () => {
  const bg = background({ menus: true, allowed: true, selection: "100 €" });
  bg.fire("installed");
  await settle();
  assert.equal(bg.calls.registered.length, 0);
  assert.equal(bg.calls.injected.length, 0);
  assert.equal(bg.listeners.permissionAdded, undefined);
  const data = await bg.send({ type: "cv-popup-data" });
  assert.equal(data.selection, undefined);
  assert.equal(data.offer, undefined);
});
