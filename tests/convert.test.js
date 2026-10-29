const { test } = require("node:test");
const assert = require("node:assert/strict");
const { translator } = require("./helpers.js");
const { convert, buildModel, availableCurrencies, menuCurrencies, modelToText, currencyName } = globalThis.CurrencyConvert;

const rates = {
  date: "29.10.2026",
  tables: {
    cash: {
      EUR: { buy: 20.0, sell: 20.28 },
      USD: { buy: 17.58, sell: 17.88 },
      GBP: { buy: 23.25, sell: 23.65 },
      RUB: { buy: null, sell: null },
    },
    card: {
      EUR: { buy: 19.9299, sell: 20.3814 },
      USD: { buy: 17.4921, sell: 17.9393 },
    },
  },
};

const bank = { id: "maib", name: "maib", pageUrl: (lang) => `https://www.maib.md/${lang}/curs-valutar` };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const model = (over) =>
  buildModel({ selection: "x", bank, rates, fetchedAt: Date.UTC(2026, 9, 29, 12, 0), lang: "en", t: translator("en"), ...over });

test("foreign -> MDL: get uses buy, pay uses sell (+fee when buying foreign)", () => {
  const r = convert(100, "EUR", "MDL", rates.tables.cash, { cashFee: true });
  close(r.get, 2000);
  close(r.pay, 2028 * 1.001);
  assert.equal(r.feeGet, false);
  assert.equal(r.feePay, true);
});

test("MDL -> foreign", () => {
  const r = convert(1000, "MDL", "EUR", rates.tables.cash, { cashFee: true });
  close(r.get, 1000 / 20.28 / 1.001);
  close(r.pay, 1000 / 20.0);
  assert.equal(r.feeGet, true);
  assert.equal(r.feePay, false);
});

test("cross rate goes through MDL", () => {
  const r = convert(100, "EUR", "USD", rates.tables.card);
  close(r.get, (100 * 19.9299) / 17.9393);
  close(r.pay, (100 * 20.3814) / 17.4921);
});

test("no fee on card", () => {
  const r = convert(100, "EUR", "MDL", rates.tables.card);
  close(r.pay, 2038.14);
  assert.equal(r.feePay, false);
});

test("missing rates return null", () => {
  assert.equal(convert(1, "GBP", "MDL", rates.tables.card), null);
  assert.equal(convert(1, "RUB", "MDL", rates.tables.cash), null);
});

test("available currencies: popular first, then the rest alphabetically", () => {
  assert.deepEqual(availableCurrencies(rates), ["MDL", "EUR", "USD", "GBP"]);
  assert.ok(!availableCurrencies(null).includes("RUB"));
  const bnm = { tables: { official: { PLN: { buy: 4.7, sell: 4.7 }, AED: { buy: 4.9, sell: 4.9 }, EUR: { buy: 20, sell: 20 } } } };
  assert.deepEqual(availableCurrencies(bnm), ["MDL", "EUR", "AED", "PLN"]);
  assert.deepEqual(menuCurrencies(bnm), ["MDL", "EUR"]);
});

test("model has both readings for ambiguous numbers", () => {
  const parsed = { text: "1,234", currency: "EUR", ambiguous: true, candidates: [1234, 1.234] };
  const m = model({ parsed, src: "EUR", dst: "MDL" });
  assert.equal(m.title, "1,234 EUR → MDL");
  assert.equal(m.readings.length, 2);
  assert.equal(m.readings[0].amount, "1,234 EUR");
  assert.equal(m.readings[1].amount, "1.234 EUR");
  assert.equal(m.readings[0].sections[0].rows[0].value, "24,680.00 MDL");
  assert.equal(m.readings[0].sections[0].rows[0].label, "Sell 1,234 EUR, you get");
  assert.equal(m.readings[0].sections[1].label, "Card operations");
  assert.ok(m.anyFee);
  assert.deepEqual(m.rateLines, ["Cash: EUR 20.00 / 20.28", "Card: EUR 19.9299 / 20.3814"]);
  assert.deepEqual(m.notes, ["* includes the 0.1% fee on buying foreign cash"]);
  assert.equal(m.dateLine, "maib rates for 29.10.2026");
  assert.match(modelToText(m, translator("en")), /If 1,234 EUR:/);
});

test("Romanian is formatted the Moldovan way", () => {
  const parsed = { text: "1.234,56", currency: "EUR", ambiguous: false, candidates: [1234.56] };
  const m = model({ parsed, src: "EUR", dst: "MDL", lang: "ro", t: translator("ro") });
  const [get, pay] = m.readings[0].sections[0].rows;
  assert.equal(get.label, "Vinzi 1.234,56 EUR, primești");
  assert.equal(get.value, "24.691,20 MDL");
  assert.equal(pay.label, "Cumperi 1.234,56 EUR, plătești");
  assert.equal(m.readings[0].sections[0].label, "Numerar la sucursale");
  assert.equal(m.link.href, "https://www.maib.md/ro/curs-valutar");
  assert.equal(m.link.text, "Pagina de curs maib ↗");
  assert.equal(m.currencies[1].name, "euro");
});

test("card section says when a currency has no card rate", () => {
  const parsed = { text: "50", currency: "GBP", ambiguous: false, candidates: [50] };
  const m = model({ parsed, src: "GBP", dst: "EUR" });
  assert.equal(m.readings[0].sections[1].unavailable, "No GBP rate");
  assert.equal(m.readings[0].sections[0].rows[0].value, "57.27 EUR");
});

test("official rate has a single row and no fee", () => {
  const parsed = { text: "100", currency: "EUR", ambiguous: false, candidates: [100] };
  const official = { date: "29.10.2026", tables: { official: { EUR: { buy: 20.1303, sell: 20.1303 } } } };
  const m = model({ parsed, src: "EUR", dst: "MDL", rates: official, bank: { ...bank, id: "bnm", name: "BNM" } });
  const s = m.readings[0].sections[0];
  assert.equal(s.label, "BNM official rate");
  assert.deepEqual(s.rows.map((r) => [r.label, r.value]), [["At the official rate", "2,013.03 MDL"]]);
  assert.equal(m.anyFee, false);
  assert.deepEqual(m.rateLines, ["BNM: EUR 20.1303"]);
  assert.deepEqual(m.notes, []);
  assert.equal(s.rows[0].rate, "1 EUR = 20.1303 MDL");
});

test("errors and stale rates are spelled out", () => {
  const parsed = { text: "5", currency: "EUR", ambiguous: false, candidates: [5] };
  const m = model({ parsed, src: "EUR", dst: "MDL", rates: null, error: "the maib page layout changed" });
  assert.equal(m.error, "Couldn't load the rates: the maib page layout changed");
  assert.equal(modelToText(m, translator("en")), m.error);
  assert.match(model({ parsed, src: "EUR", dst: "MDL", stale: true }).stale, /last saved rates/);
});

test("bank note goes in the footer", () => {
  const parsed = { text: "5", currency: "EUR", ambiguous: false, candidates: [5] };
  const m = model({ parsed, src: "EUR", dst: "MDL", bank: { ...bank, noteKey: "noteEnergbank" } });
  assert.equal(m.notes[m.notes.length - 1], "Central Office rates. Other branches may differ.");
});

test("currency names follow the language", () => {
  assert.equal(currencyName("MDL", "ro"), "leu moldovenesc");
  assert.equal(currencyName("MDL", "ru"), "молдавский лей");
  assert.equal(currencyName("MDL", "en"), "Moldovan Leu");
});

test("each result carries what the box copies and the effective rate", () => {
  const parsed = { text: "100", currency: "EUR", ambiguous: false, candidates: [100] };
  const [get, pay] = model({ parsed, src: "EUR", dst: "MDL" }).readings[0].sections[0].rows;
  assert.equal(get.number, "2,000.00");
  assert.equal(get.currency, "MDL");
  assert.equal(get.rate, "1 EUR = 20.00 MDL");
  assert.equal(pay.rate, "1 EUR = 20.3003 MDL"); // 20.28 plus the 0.1% fee
  const lei = model({ parsed: { ...parsed, currency: "MDL" }, src: "MDL", dst: "EUR", lang: "ro", t: translator("ro") });
  // Quoted per euro, not per leu.
  assert.equal(lei.readings[0].sections[0].rows[1].rate, "1 EUR = 20,00 MDL");
});

test("best rate badge: most received, least paid, only when there's a choice", () => {
  const parsed = { text: "100", currency: "EUR", ambiguous: false, candidates: [100] };
  const [cash, card] = model({ parsed, src: "EUR", dst: "MDL" }).readings[0].sections;
  // Selling: cash 2000 vs card 1992.99. Buying: cash 2030.03 vs card 2038.14.
  assert.deepEqual([cash.rows[0].best, card.rows[0].best], [true, false]);
  assert.deepEqual([cash.rows[1].best, card.rows[1].best], [true, false]);
  const onlyCash = model({ parsed, src: "EUR", dst: "MDL", rates: { ...rates, tables: { cash: rates.tables.cash } } });
  assert.ok(onlyCash.readings[0].sections[0].rows.every((r) => !r.best));
  const tie = { ...rates, tables: { cash: { EUR: { buy: 20, sell: 20.5 } }, card: { EUR: { buy: 20, sell: 20.5 } } } };
  const flat = model({ parsed, src: "EUR", dst: "MDL", rates: tie }).readings[0].sections.flatMap((s) => s.rows);
  assert.ok(flat.filter((r) => r.key === "get").every((r) => !r.best), "a tie gets no badge");
});

test("no number still gives pickers and a hint", () => {
  const m = model({ selection: "abc", parsed: null, src: "EUR", dst: "MDL" });
  assert.equal(m.hint, "No amount found. Type one above.");
  assert.equal(m.readings.length, 0);
  assert.deepEqual(m.currencies.map((c) => c.code), ["MDL", "EUR", "USD", "GBP"]);
  assert.equal(m.amountText, "abc");
  assert.equal(modelToText(m, translator("en")), m.hint);
});

test("the model carries what the view needs for 'updated … ago'", () => {
  const parsed = { text: "5", currency: "EUR", ambiguous: false, candidates: [5] };
  const m = model({ parsed, src: "EUR", dst: "MDL", lang: "ru", t: translator("ru") });
  assert.equal(m.locale, "ru-MD");
  assert.equal(m.fetchedAt, Date.UTC(2026, 9, 29, 12, 0));
  assert.equal(m.amountText, "5");
});
