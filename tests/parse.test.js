const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseSelection } = require("../lib/parse.js");

const cases = [
  // [selection, candidates, currency]
  ["1.234,56 €", [1234.56], "EUR"],
  ["$1,234.56", [1234.56], "USD"],
  ["1 234,56 lei", [1234.56], "MDL"],
  ["1 234,56 MDL", [1234.56], "MDL"],
  ["1 234,56 €", [1234.56], "EUR"],
  ["1'234.50 CHF", [1234.5], "CHF"],
  ["12,5", [12.5], null],
  ["12.50", [12.5], null],
  ["0,125", [0.125], null],
  ["1,234", [1234, 1.234], null],
  ["1.234 EUR", [1234, 1.234], "EUR"],
  ["1.234.567", [1234567], null],
  ["1,234,567.89 USD", [1234567.89], "USD"],
  ["EUR 100", [100], "EUR"],
  ["-5,00", [-5], null],
  ["−5,00 €", [-5], "EUR"],
  ["100 грн", [100], "UAH"],
  ["₴250", [250], "UAH"],
  ["£ 99.99", [99.99], "GBP"],
  ["350 RON", [350], "RON"],
  ["1500 руб.", [1500], "RUB"],
  ["Price: 2 499 lei", [2499], "MDL"],
  ["Total 19.99 USD incl. VAT", [19.99], "USD"],
  ["US$15", [15], "USD"],
  ["10, 20, 30", [10], null],
  ["2024 100", [2024], null],
  ["12345,678", [12345.678], null],
  ["costs 45 euro", [45], "EUR"],
  ["item-5 lei", [5], "MDL"],
];

for (const [input, candidates, currency] of cases) {
  test(`parses ${JSON.stringify(input)}`, () => {
    const r = parseSelection(input);
    assert.ok(r, "expected a result");
    assert.equal(r.currency, currency);
    assert.equal(r.candidates.length, candidates.length);
    r.candidates.forEach((v, i) => assert.ok(Math.abs(v - candidates[i]) < 1e-9, `${v} != ${candidates[i]}`));
    assert.equal(r.ambiguous, candidates.length > 1);
  });
}

test("keeps the selected number text for the menu", () => {
  assert.equal(parseSelection("1.234,56 €").text, "1.234,56");
  assert.equal(parseSelection("EUR -5").text, "-5");
  assert.equal(parseSelection("2024 100").text, "2024");
});

test("does not match 'lei' inside another word", () => {
  assert.equal(parseSelection("bleile 100").currency, null);
});

test("returns null for non-numbers and long selections", () => {
  assert.equal(parseSelection("abc"), null);
  assert.equal(parseSelection(""), null);
  assert.equal(parseSelection(undefined), null);
  assert.equal(parseSelection("x".repeat(100) + " 5"), null);
});
