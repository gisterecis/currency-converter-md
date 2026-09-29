// Conversion math and the view model the result box renders.
(function (root) {
  "use strict";

  // Fee on cash purchases of foreign currency by individuals (Law 827-XIV).
  const CASH_FEE = 0.001;

  const CURRENCIES = {
    MDL: "Moldovan leu",
    EUR: "Euro",
    USD: "US dollar",
    GBP: "British pound",
    RON: "Romanian leu",
    UAH: "Ukrainian hryvnia",
    CHF: "Swiss franc",
    RUB: "Russian ruble",
  };
  const ORDER = Object.keys(CURRENCIES);

  function rateOf(table, code) {
    if (code === "MDL") return { buy: 1, sell: 1 };
    const r = table && table[code];
    return r && Number.isFinite(r.buy) && Number.isFinite(r.sell) ? r : null;
  }

  // "Sell X src, you get": the bank buys src and sells dst.
  // "Buy X src, you pay":  the bank sells src and buys dst.
  function convert(amount, src, dst, table, { cashFee = false } = {}) {
    const s = rateOf(table, src);
    const d = rateOf(table, dst);
    if (!s || !d) return null;
    const feeGet = cashFee && dst !== "MDL";
    const feePay = cashFee && src !== "MDL";
    let get = (amount * s.buy) / d.sell;
    let pay = (amount * s.sell) / d.buy;
    if (feeGet) get /= 1 + CASH_FEE;
    if (feePay) pay *= 1 + CASH_FEE;
    return { get, pay, feeGet, feePay };
  }

  // Currencies that have usable cash rates (RUB is often "-").
  function availableCurrencies(rates) {
    if (!rates || !rates.cash) return ORDER.filter((c) => c !== "RUB");
    return ORDER.filter((c) => rateOf(rates.cash, c) || rateOf(rates.card, c));
  }

  const moneyFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rateFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const amountFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

  const money = (v) => moneyFmt.format(v);

  function rateLine(table, codes) {
    return codes
      .map((c) => {
        const r = rateOf(table, c);
        return r && c !== "MDL" ? `${c} ${rateFmt.format(r.buy)} / ${rateFmt.format(r.sell)}` : null;
      })
      .filter(Boolean)
      .join(" · ");
  }

  // Everything the box (or the notification fallback) needs, pre-formatted.
  function buildModel({ parsed, src, dst, rates, stale = false, fetchedAt = null, error = null }) {
    const model = {
      title: `${parsed.text} ${src} → ${dst}`,
      src,
      dst,
      ambiguous: parsed.ambiguous,
      readings: [],
      error,
      stale,
      date: rates ? rates.date : null,
      fetchedAt,
      rateLines: [],
      anyFee: false,
    };
    if (!rates) return model;

    for (const amount of parsed.candidates) {
      const reading = {
        amount: `${amountFmt.format(amount)} ${src}`,
        sections: [],
      };
      for (const [key, label, table, cashFee] of [
        ["cash", "Cash at branches", rates.cash, true],
        ["card", "Card operations", rates.card, false],
      ]) {
        const r = convert(amount, src, dst, table, { cashFee });
        if (!r) {
          const missing = [src, dst].filter((c) => !rateOf(table, c)).join(", ");
          reading.sections.push({ key, label, unavailable: `No ${missing} rate` });
          continue;
        }
        if (r.feeGet || r.feePay) model.anyFee = true;
        reading.sections.push({
          key,
          label,
          get: { label: `Sell ${reading.amount}, you get`, short: `Sell ${src}, you get`, value: `${money(r.get)} ${dst}`, fee: r.feeGet },
          pay: { label: `Buy ${reading.amount}, you pay`, short: `Buy ${src}, you pay`, value: `${money(r.pay)} ${dst}`, fee: r.feePay },
        });
      }
      model.readings.push(reading);
    }

    const codes = [src, dst];
    const cashLine = rateLine(rates.cash, codes);
    const cardLine = rateLine(rates.card, codes);
    if (cashLine) model.rateLines.push(`Cash ${cashLine}`);
    if (cardLine) model.rateLines.push(`Card ${cardLine}`);
    return model;
  }

  // Plain-text version for system notifications.
  function modelToText(model) {
    if (model.error && !model.readings.length) return `Couldn't load maib rates: ${model.error}`;
    const lines = [];
    for (const reading of model.readings) {
      if (model.ambiguous) lines.push(`If ${reading.amount}:`);
      for (const s of reading.sections) {
        if (s.unavailable) lines.push(`${s.label}: ${s.unavailable}`);
        else lines.push(`${s.label}: get ${s.get.value} · pay ${s.pay.value}`);
      }
    }
    if (model.date) lines.push(`maib rates for ${model.date}${model.stale ? " (cached)" : ""}`);
    return lines.join("\n");
  }

  const api = { CASH_FEE, CURRENCIES, ORDER, rateOf, convert, availableCurrencies, buildModel, modelToText };
  root.MaibConvert = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
