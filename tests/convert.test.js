const { test } = require("node:test");
const assert = require("node:assert/strict");
const { convert, buildModel, availableCurrencies, modelToText } = require("../lib/convert.js");

const rates = {
  date: "29.09.2026",
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
};

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("foreign -> MDL: get uses buy, pay uses sell (+fee when buying foreign)", () => {
  const r = convert(100, "EUR", "MDL", rates.cash, { cashFee: true });
  close(r.get, 2000);
  close(r.pay, 2028 * 1.001);
  assert.equal(r.feeGet, false);
  assert.equal(r.feePay, true);
});

test("MDL -> foreign", () => {
  const r = convert(1000, "MDL", "EUR", rates.cash, { cashFee: true });
  close(r.get, 1000 / 20.28 / 1.001);
  close(r.pay, 1000 / 20.0);
  assert.equal(r.feeGet, true);
  assert.equal(r.feePay, false);
});

test("cross rate goes through MDL", () => {
  const r = convert(100, "EUR", "USD", rates.card);
  close(r.get, (100 * 19.9299) / 17.9393);
  close(r.pay, (100 * 20.3814) / 17.4921);
});

test("no fee on card", () => {
  const r = convert(100, "EUR", "MDL", rates.card);
  close(r.pay, 2038.14);
  assert.equal(r.feePay, false);
});

test("missing rates return null", () => {
  assert.equal(convert(1, "GBP", "MDL", rates.card), null);
  assert.equal(convert(1, "RUB", "MDL", rates.cash), null);
});

test("available currencies skip ones without rates", () => {
  assert.deepEqual(availableCurrencies(rates), ["MDL", "EUR", "USD", "GBP"]);
  assert.ok(!availableCurrencies(null).includes("RUB"));
});

test("model has both readings for ambiguous numbers", () => {
  const parsed = { text: "1,234", currency: "EUR", ambiguous: true, candidates: [1234, 1.234] };
  const m = buildModel({ parsed, src: "EUR", dst: "MDL", rates, fetchedAt: 1 });
  assert.equal(m.title, "1,234 EUR → MDL");
  assert.equal(m.readings.length, 2);
  assert.equal(m.readings[0].amount, "1,234 EUR");
  assert.equal(m.readings[1].amount, "1.234 EUR");
  assert.equal(m.readings[0].sections[0].get.value, "24,680.00 MDL");
  assert.equal(m.readings[0].sections[1].label, "Card operations");
  assert.ok(m.anyFee);
  assert.deepEqual(m.rateLines, ["Cash EUR 20.00 / 20.28", "Card EUR 19.9299 / 20.3814"]);
  assert.match(modelToText(m), /If 1,234 EUR:/);
});

test("card section says when a currency has no card rate", () => {
  const parsed = { text: "50", currency: "GBP", ambiguous: false, candidates: [50] };
  const m = buildModel({ parsed, src: "GBP", dst: "EUR", rates });
  assert.equal(m.readings[0].sections[1].unavailable, "No GBP rate");
  assert.equal(m.readings[0].sections[0].get.value, "57.27 EUR");
});
