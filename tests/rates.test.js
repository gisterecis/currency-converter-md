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
