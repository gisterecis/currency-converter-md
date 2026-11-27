const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./helpers.js");
const { ErrorReport, Scrape } = globalThis;

const DSN = "https://0123456789abcdef0123456789abcdef@o1.ingest.de.sentry.io/4500000000000001";

// A stand-in browser: storage, optional Firefox data consent, and fetch.
function fakeBrowser({ dataCollection, reportErrors } = {}) {
  const store = { local: {}, sync: reportErrors === undefined ? {} : { reportErrors } };
  const area = (name) => ({
    get: async (keys) => {
      if (typeof keys === "string") return keys in store[name] ? { [keys]: store[name][keys] } : {};
      return { ...keys, ...store[name] };
    },
    set: async (o) => Object.assign(store[name], o),
  });
  const api = {
    runtime: { getManifest: () => ({ version: "9.9.9" }) },
    storage: { local: area("local"), sync: area("sync") },
    permissions: {
      getAll: async () => (dataCollection === undefined ? { origins: [], permissions: [] } : { origins: [], permissions: [], data_collection: dataCollection }),
    },
  };
  const sent = [];
  return { api, store, sent, fetch: async (url, init) => sent.push({ url, init }) };
}

async function withBrowser(opts, fn) {
  const real = { Ext: globalThis.Ext, fetch: globalThis.fetch };
  const b = fakeBrowser(opts);
  globalThis.Ext = { api: b.api };
  globalThis.fetch = b.fetch;
  try {
    return await fn(b);
  } finally {
    globalThis.Ext = real.Ext;
    globalThis.fetch = real.fetch;
  }
}

const layout = () => Scrape.layoutError("cash table not found");

test("the DSN turns into Sentry's envelope endpoint", () => {
  assert.deepEqual(ErrorReport.parseDsn(DSN), {
    key: "0123456789abcdef0123456789abcdef",
    url: "https://o1.ingest.de.sentry.io/api/4500000000000001/envelope/?sentry_key=0123456789abcdef0123456789abcdef&sentry_version=7",
  });
  assert.equal(ErrorReport.parseDsn(""), null);
  assert.equal(ErrorReport.parseDsn("http://key@host/1"), null);
});

test("without a browser consent, reports are on until the user turns them off", async () => {
  await withBrowser({}, async (b) => {
    assert.deepEqual(await ErrorReport.status(DSN), { available: true, builtIn: false, enabled: true });
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: DSN }), true);
    assert.equal(b.sent.length, 1);
  });
});

test("nothing is sent once the user turns reports off", async () => {
  await withBrowser({ dataCollection: [] }, async (b) => {
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: DSN }), false);
    assert.equal(b.sent.length, 0);
  });
  await withBrowser({ reportErrors: false }, async (b) => {
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: DSN }), false);
    assert.equal(b.sent.length, 0);
  });
});

test("Firefox's data consent wins over the setting", async () => {
  await withBrowser({ dataCollection: [], reportErrors: true }, async (b) => {
    assert.deepEqual(await ErrorReport.status(DSN), { available: true, builtIn: true, enabled: false });
    await ErrorReport.bankFailure("maib", layout(), { dsn: DSN });
    assert.equal(b.sent.length, 0);
  });
  await withBrowser({ dataCollection: ["technicalAndInteraction"] }, async (b) => {
    await ErrorReport.bankFailure("maib", layout(), { dsn: DSN });
    assert.equal(b.sent.length, 1);
  });
});

test("without a DSN reporting is off and the setting is hidden", async () => {
  await withBrowser({ reportErrors: true }, async (b) => {
    assert.deepEqual(await ErrorReport.status(""), { available: false, builtIn: false, enabled: false });
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: "" }), false);
    assert.equal(b.sent.length, 0);
  });
});

test("with consent, one report per bank, error and day", async () => {
  await withBrowser({ reportErrors: true }, async (b) => {
    const now = Date.UTC(2026, 10, 27, 12);
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: DSN, now }), true);
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: DSN, now: now + 60e3 }), false);
    assert.equal(await ErrorReport.bankFailure("otp", layout(), { dsn: DSN, now: now + 60e3 }), true);
    assert.equal(await ErrorReport.bankFailure("maib", new Scrape.RateError("http", "404"), { dsn: DSN, now: now + 60e3 }), true);
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: DSN, now: now + 25 * 3600e3 }), true);
    assert.equal(b.sent.length, 4);
  });
});

test("being offline or rate-limited isn't reported", async () => {
  await withBrowser({ reportErrors: true }, async (b) => {
    await ErrorReport.bankFailure("maib", new Scrape.RateError("network", "Failed to fetch"), { dsn: DSN });
    await ErrorReport.bankFailure("procredit", new Scrape.RateError("busy", "571"), { dsn: DSN });
    assert.equal(b.sent.length, 0);
  });
});

test("the report is a simple, cookie-less request with only the bank, error and versions", async () => {
  await withBrowser({ reportErrors: true }, async (b) => {
    await ErrorReport.bankFailure("maib", layout(), { dsn: DSN });
    const [{ url, init }] = b.sent;
    assert.equal(url, ErrorReport.parseDsn(DSN).url);
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "omit");
    assert.match(init.headers["Content-Type"], /^text\/plain/);
    const [header, item, event] = init.body.split("\n").map((l) => JSON.parse(l));
    assert.equal(header.dsn, DSN);
    assert.equal(header.event_id, event.event_id);
    assert.deepEqual(item, { type: "event" });
    assert.deepEqual(Object.keys(event).sort(), ["environment", "event_id", "fingerprint", "level", "logger", "message", "platform", "release", "sdk", "tags", "timestamp"]);
    assert.equal(event.message.formatted, "maib: layout (cash table not found)");
    assert.equal(event.release, "convertor-valutar-md@9.9.9");
    assert.deepEqual(event.fingerprint, ["bank-failure", "maib", "layout"]);
    assert.equal(event.tags.bank, "maib");
    assert.equal(event.tags.code, "layout");
    assert.equal(event.sdk.settings.infer_ip, "never");
    assert.ok(!("user" in event) && !("request" in event));
  });
});

test("a failing report never throws", async () => {
  await withBrowser({ reportErrors: true }, async () => {
    globalThis.fetch = async () => {
      throw new TypeError("offline");
    };
    assert.equal(await ErrorReport.bankFailure("maib", layout(), { dsn: DSN }), false);
  });
});

test("browser names from user agents", () => {
  const ff = "Mozilla/5.0 (Android 14; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0";
  const chrome = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const edge = `${chrome} Edg/141.0.0.0`;
  assert.deepEqual(ErrorReport.browserInfo(ff), { name: "Firefox", version: "145", mobile: true });
  assert.deepEqual(ErrorReport.browserInfo(chrome), { name: "Chrome", version: "141", mobile: false });
  assert.equal(ErrorReport.browserInfo(edge).name, "Chrome");
});

// rates.js hands every failed fetch to the reporter.
test("a failed rate fetch is passed to the reporter", async () => {
  const { BankRates, Banks } = globalThis;
  const real = { report: ErrorReport.bankFailure };
  const seen = [];
  ErrorReport.bankFailure = async (id, e) => seen.push([id, e.code]);
  try {
    await withBrowser({}, async () => {
      globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "<html>curs__valutar_date</html>" });
      await assert.rejects(BankRates.getRates("maib"), (e) => e.code === "layout");
    });
  } finally {
    ErrorReport.bankFailure = real.report;
  }
  assert.deepEqual(seen, [["maib", "layout"]]);
  assert.ok(Banks.get("maib"));
});
