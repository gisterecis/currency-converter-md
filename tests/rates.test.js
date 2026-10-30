const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./helpers.js");
const { Banks, BankRates } = globalThis;

// Rate requests must not carry the user's bank cookies (and so any logged-in
// session), except for the sites behind a bot check, which need its cookie.
test("only bot-checked banks are fetched with cookies", async () => {
  const realFetch = globalThis.fetch;
  const realExt = globalThis.Ext;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, credentials: init.credentials });
    throw new TypeError("offline");
  };
  globalThis.Ext = { api: { tabs: { create: async () => Promise.reject(new Error("no tabs")) } } };
  try {
    for (const bank of Banks.all()) {
      seen.length = 0;
      await assert.rejects(BankRates.fetchFresh(bank));
      assert.ok(seen.length > 0, bank.id);
      const expected = bank.tabFallback ? "include" : "omit";
      for (const r of seen) assert.equal(r.credentials, expected, `${bank.id}: ${r.url}`);
    }
  } finally {
    globalThis.fetch = realFetch;
    globalThis.Ext = realExt;
  }
});

// fetchViaTab against a stand-in tab that shows `pages` in turn (the last one
// stays), on a fake clock so the waits take no real time.
async function viaTab(pages) {
  const { fixture } = require("./helpers.js");
  const real = { Ext: globalThis.Ext, now: Date.now, setTimeout: globalThis.setTimeout };
  let now = real.now();
  const removed = [];
  let shown = 0;
  Date.now = () => now;
  globalThis.setTimeout = (fn, ms = 0) => {
    now += ms;
    return real.setTimeout(fn, 0);
  };
  globalThis.Ext = {
    api: {
      tabs: { create: async () => ({ id: 3 }), remove: async (id) => void removed.push(id) },
      // Runs the real injected function on the page the tab shows now.
      scripting: {
        executeScript: async ({ func, args }) => {
          const page = pages[Math.min(shown++, pages.length - 1)];
          globalThis.document = { documentElement: { outerHTML: page.startsWith("<") ? page : fixture(page) } };
          try {
            return [{ result: func(...args) }];
          } finally {
            delete globalThis.document;
          }
        },
      },
    },
  };
  const start = now;
  try {
    const req = Banks.get("maib").requests()[0];
    const html = await BankRates.fetchViaTab(req).catch((e) => e);
    return { html, waited: now - start, removed };
  } finally {
    Object.assign(globalThis, { Ext: real.Ext, setTimeout: real.setTimeout });
    Date.now = real.now;
  }
}

const ratesPage = () => `<html>${Banks.get("maib").requests()[0].marker}</html>`;

test("the bot-check tab returns the page once the challenge passes", async () => {
  const r = await viaTab(["incapsula.html", "incapsula.html", ratesPage()]);
  assert.equal(r.html, ratesPage());
  assert.deepEqual(r.removed, [3]);
});

test("the bot-check tab gives up on a hard block after a few seconds, not at the timeout", async () => {
  const r = await viaTab(["incapsula-blocked.html"]);
  assert.equal(r.html.code, "blocked");
  assert.ok(r.waited >= 5000 && r.waited < 7000, `gave up after ${r.waited} ms`);
  assert.deepEqual(r.removed, [3]);
});

test("a hard block that clears within the grace period still gets the page", async () => {
  const r = await viaTab(["incapsula-blocked.html", "incapsula-blocked.html", ratesPage()]);
  assert.equal(r.html, ratesPage());
});

test("a challenge that never passes still ends at the timeout", async () => {
  const r = await viaTab(["incapsula.html"]);
  assert.equal(r.html.code, "timeout");
  assert.ok(r.waited >= 25000, `gave up after ${r.waited} ms`);
});
