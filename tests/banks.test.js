const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bankFixture, fixture } = require("./helpers.js");
const { Banks, Scrape } = globalThis;

// Trimmed real responses saved on 29.10.2026 (tests/fixtures/banks/).
const json = (name) => JSON.parse(bankFixture(name));
const BODIES = {
  maib: () => [bankFixture("maib.html")],
  micb: () => [bankFixture("micb.html")],
  victoriabank: () => [json("victoriabank-11.json"), json("victoriabank-14.json")],
  otp: () => [bankFixture("otp.html")],
  procredit: () => [bankFixture("procredit.html")],
  fincombank: () => [bankFixture("fincombank-cash.html"), bankFixture("fincombank-card.html")],
  eximbank: () => [bankFixture("eximbank.html")],
  energbank: () => ["cash", "card", "pref"].map((t) => json(`energbank-${t}.json`)),
  comertbank: () => [bankFixture("comertbank.html")],
  ecb: () => [bankFixture("ecb.html")],
  bnm: () => [bankFixture("bnm.xml")],
};

// [bank, date, table, code, buy, sell]
const EXPECT = [
  ["maib", "29.10.2026", "cash", "EUR", 19.9, 20.2],
  ["maib", "29.10.2026", "card", "USD", 17.711, 18.3212],
  ["micb", null, "cash", "GBP", 23.6, 24.1],
  ["micb", null, "card", "EUR", 19.85, 20.45],
  ["victoriabank", "29.10.2026", "cash", "EUR", 20.03, 20.24],
  ["victoriabank", "29.10.2026", "online", "USD", 17.9, 18.25],
  ["otp", "29.10.2026", "cash", "EUR", 20.02, 20.22],
  ["otp", "29.10.2026", "card", "RUB", 0.198, 0.249],
  ["procredit", "29.10.2026", "cash", "EUR", 19.98, 20.21],
  ["procredit", "29.10.2026", "card", "USD", 17.8, 18.3],
  ["fincombank", "29.10.2026", "cash", "EUR", 20.03, 20.18],
  ["fincombank", "29.10.2026", "card", "EUR", 19.86, 20.34],
  ["eximbank", "29.10.2026", "cash", "RON", 3.7, 3.8],
  ["eximbank", "29.10.2026", "card", "EUR", 19.93, 20.25],
  ["energbank", "29.10.2026", "cash", "CHF", 20, 22],
  ["energbank", "29.10.2026", "online", "RON", 3.72, 3.82],
  ["comertbank", "29.10.2026", "cash", "RON", 3.7, 3.8],
  ["comertbank", "29.10.2026", "card", "USD", 17.75, 18.25],
  ["ecb", "29.10.2026", "cash", "CHF", 21.4, 21.8],
  ["ecb", "29.10.2026", "card", "EUR", 19.84, 20.28],
  ["bnm", "29.10.2026", "official", "EUR", 20.1303, 20.1303],
];

const NOW = { iso: "2026-10-29", time: "21:00" };
const parse = (id) => Banks.get(id).parse(BODIES[id](), { now: NOW });

test("every bank in ORDER has an adapter and a fixture", () => {
  assert.deepEqual(Banks.all().map((b) => b.id), Banks.ORDER);
  for (const id of Banks.ORDER) assert.ok(BODIES[id], `no fixture for ${id}`);
});

for (const [id, date, table, code, buy, sell] of EXPECT) {
  test(`${id}: ${table} ${code} ${buy} / ${sell}`, () => {
    const r = parse(id);
    assert.equal(r.date, date);
    assert.deepEqual(r.tables[table][code], { buy, sell });
  });
}

test("rates that aren't quoted become null, MDL is skipped", () => {
  assert.deepEqual(parse("maib").tables.cash.RUB, { buy: null, sell: null });
  assert.deepEqual(parse("micb").tables.cash.UAH, { buy: null, sell: null });
  assert.deepEqual(parse("otp").tables.cash.RUB, { buy: null, sell: null });
  for (const id of Banks.ORDER) {
    for (const t of Object.values(parse(id).tables)) assert.ok(!("MDL" in t), `${id} has MDL`);
  }
});

test("currency sets match the banks' pages", () => {
  assert.deepEqual(Object.keys(parse("maib").tables.cash), ["EUR", "USD", "GBP", "RON", "UAH", "CHF", "RUB"]);
  assert.deepEqual(Object.keys(parse("comertbank").tables.cash), ["EUR", "USD", "RON"]);
  assert.deepEqual(Object.keys(parse("ecb").tables.card), ["EUR", "USD"]);
  assert.equal(Object.keys(parse("bnm").tables.official).length, 40);
});

test("BNM divides by the nominal", () => {
  const { official } = parse("bnm").tables;
  // <CharCode>JPY</CharCode><Nominal>100</Nominal>
  assert.ok(official.JPY.buy > 0.05 && official.JPY.buy < 0.5, String(official.JPY.buy));
});

test("Victoriabank uses the latest rate set that has started", () => {
  const morning = Banks.get("victoriabank").parse(BODIES.victoriabank(), { now: { iso: "2026-10-29", time: "10:00" } });
  assert.equal(morning.time, "09:00");
  assert.deepEqual(morning.tables.cash.EUR, { buy: 19.97, sell: 20.27 });
  assert.equal(parse("victoriabank").time, "11:18");
});

test("a bot-check page or junk throws a layout error", () => {
  const challenge = fixture("incapsula.html");
  for (const id of ["maib", "micb", "otp", "procredit", "eximbank", "comertbank", "ecb", "bnm"]) {
    assert.throws(() => Banks.get(id).parse([challenge, challenge]), (e) => e.code === "layout", id);
  }
  assert.throws(() => Banks.get("energbank").parse([{ detail: "x" }, {}, {}]), (e) => e.code === "layout");
  assert.throws(() => Banks.get("victoriabank").parse([{}, {}], { now: NOW }), (e) => e.code === "layout");
});

test("every bank has a page link for each language and https requests", () => {
  for (const b of Banks.all()) {
    for (const lang of ["ro", "en", "ru"]) assert.match(b.pageUrl(lang), /^https:\/\//, `${b.id} ${lang}`);
    for (const r of b.requests()) assert.match(r.url, /^https:\/\//);
  }
});

test("scrape helpers", () => {
  assert.equal(Scrape.toRate("20,18"), 20.18);
  assert.equal(Scrape.toRate("20.1800 MDL"), 20.18);
  assert.equal(Scrape.toRate(" 17.80 "), 17.8);
  assert.equal(Scrape.toRate("-"), null);
  assert.equal(Scrape.toRate("0.0000"), null);
  assert.equal(Scrape.toDate("2026.10.29"), "29.10.2026");
  assert.equal(Scrape.toDate("la data de 29/10/2026"), "29.10.2026");
  assert.equal(Scrape.text("<b>Euro</b>&nbsp;<i>(EUR)</i> &#8364;"), "Euro (EUR) €");
  assert.equal(Scrape.between("a [x] b [y]", "[", ["]", "b"]), "[x");
  assert.deepEqual(Scrape.chunks("_<li>a<li>b", "<li>"), ["<li>a", "<li>b"]);
  assert.equal(Scrape.attr('<tr data-code="EUR" data-rate-buy="1">', "data-rate-buy"), "1");
  assert.deepEqual(Scrape.chisinau(0, Date.UTC(2026, 9, 29, 22, 30)), { iso: "2026-10-30", dmy: "30.10.2026", time: "00:30" });
});
