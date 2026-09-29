const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DOMParser } = require("linkedom");
const { parseRates, isChallengePage } = require("../lib/rates.js");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const parse = (html) => new DOMParser().parseFromString(html, "text/html");

test("parses cash and card tables from the maib page", () => {
  const r = parseRates(parse(fixture("curs-valutar.html")));
  assert.equal(r.date, "29.09.2026");
  assert.deepEqual(r.cash.EUR, { buy: 20.0, sell: 20.28, bnm: 20.1931 });
  assert.deepEqual(r.cash.UAH, { buy: 0.32, sell: 0.38, bnm: 0.3957 });
  assert.deepEqual(r.cash.RUB, { buy: null, sell: null, bnm: null });
  assert.deepEqual(Object.keys(r.cash), ["EUR", "USD", "GBP", "RON", "UAH", "CHF", "RUB"]);
  assert.deepEqual(r.card, {
    EUR: { buy: 19.9299, sell: 20.3814 },
    USD: { buy: 17.4921, sell: 17.9393 },
  });
});

test("detects the Incapsula challenge page", () => {
  assert.equal(isChallengePage(fixture("incapsula.html")), true);
  assert.equal(isChallengePage(fixture("curs-valutar.html")), false);
});

test("throws a clear error when the layout changes", () => {
  assert.throws(() => parseRates(parse(fixture("incapsula.html"))), /layout changed/);
});
