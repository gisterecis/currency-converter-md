// Conversion math and the view model the result box renders. All text in the
// model is already localised, so the box and the notification just show it.
(function (root) {
  "use strict";

  // Fee on cash purchases of foreign currency by individuals (Law 827-XIV),
  // charged by every bank.
  const CASH_FEE = 0.001;

  // Rate tables in display order. Labels are the i18n keys cat_<key> / short_<key>.
  const CATEGORIES = ["cash", "card", "online", "official"];

  // Offered in menus when the bank has them; the box pickers list every currency.
  const POPULAR = ["MDL", "EUR", "USD", "GBP", "RON", "UAH", "CHF", "RUB"];

  const LOCALES = { ro: "ro-MD", ru: "ru-MD", en: "en-US" };
  const localeOf = (lang) => LOCALES[lang] || LOCALES.ro;

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

  // Currencies with a usable rate in any of the bank's tables, popular ones first.
  function availableCurrencies(rates) {
    if (!rates || !rates.tables) return POPULAR.filter((c) => c !== "RUB");
    const codes = new Set(["MDL"]);
    for (const table of Object.values(rates.tables)) {
      for (const code of Object.keys(table || {})) if (rateOf(table, code)) codes.add(code);
    }
    const rest = [...codes].filter((c) => !POPULAR.includes(c)).sort();
    return [...POPULAR.filter((c) => codes.has(c)), ...rest];
  }

  const menuCurrencies = (rates) => availableCurrencies(rates).filter((c) => POPULAR.includes(c));

  const names = new Map();
  function currencyName(code, lang) {
    const locale = localeOf(lang);
    if (!names.has(locale)) names.set(locale, new Intl.DisplayNames([locale], { type: "currency" }));
    try {
      return names.get(locale).of(code);
    } catch (e) {
      return code;
    }
  }

  function formats(lang) {
    const locale = localeOf(lang);
    return {
      locale,
      money: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      rate: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }),
    };
  }

  function rateLine(table, codes, fmt, official) {
    return codes
      .map((c) => {
        const r = rateOf(table, c);
        if (!r || c === "MDL") return null;
        return official ? `${c} ${fmt.rate.format(r.buy)}` : `${c} ${fmt.rate.format(r.buy)} / ${fmt.rate.format(r.sell)}`;
      })
      .filter(Boolean)
      .join(" · ");
  }

  // "1 EUR = 19,90 MDL", quoted per foreign unit when one side is MDL.
  function effectiveRate(amount, value, src, dst, fmt) {
    if (!amount || !value) return null;
    if (src === "MDL" && dst !== "MDL") return `1 ${dst} = ${fmt.rate.format(amount / value)} MDL`;
    return `1 ${src} = ${fmt.rate.format(value / amount)} ${dst}`;
  }

  // One result: `value` is what the box shows, `number` what a click copies.
  function resultRow({ key, label, short, raw, fee }, { amount, src, dst, fmt }) {
    const number = fmt.money.format(raw);
    return { key, label, short, raw, number, currency: dst, value: `${number} ${dst}`, fee, rate: effectiveRate(amount, raw, src, dst, fmt), best: false };
  }

  // With two or more rate types, flag the single best one to sell at (most
  // received) and to buy at (least paid). Ties get no badge.
  function markBest(sections) {
    for (const [key, sign] of [["get", 1], ["pay", -1]]) {
      const rows = sections.flatMap((s) => (s.rows || []).filter((r) => r.key === key));
      if (rows.length < 2) continue;
      const top = Math.max(...rows.map((r) => sign * r.raw));
      const winners = rows.filter((r) => Math.abs(sign * r.raw - top) < 0.005);
      if (winners.length === 1) winners[0].best = true;
    }
  }

  // Everything the box, the popup and the notification fallback need.
  //   selection    the selected or typed text; parsed is its CurrencyParse
  //                result, or null when it has no number
  //   src, dst     currency codes
  //   bank         { id, name, pageUrl, noteKey }; banks: [{ id, name }] for the picker
  //   rates        adapter result { date, time, tables } or null
  //   error        already localised message, or null
  function buildModel({
    selection,
    parsed,
    src,
    dst,
    srcGuessed = false,
    bank,
    banks = [],
    rates,
    fetchedAt = null,
    stale = false,
    error = null,
    lang,
    t,
  }) {
    const fmt = formats(lang);
    const model = {
      title: parsed ? `${parsed.text} ${src} → ${dst}` : t("appName"),
      request: { selection, src, dst, bank: bank.id },
      amountText: parsed ? parsed.text : selection || "",
      bank: { id: bank.id, name: bank.name },
      banks,
      currencies: availableCurrencies(rates).concat([src, dst]).filter((c, i, a) => a.indexOf(c) === i).map((code) => ({ code, name: currencyName(code, lang) })),
      srcGuessed: !!parsed && srcGuessed,
      hint: parsed ? null : t("noNumberHint"),
      ambiguous: !!parsed && parsed.ambiguous,
      readings: [],
      error: error ? t("errLoad", error) : null,
      stale: stale ? t("staleNote", bank.name) : null,
      fetchedAt,
      locale: fmt.locale,
      dateLine: null,
      rateLines: [],
      notes: [],
      link: { href: bank.pageUrl(lang), text: t("openBankPage", bank.name) },
      anyFee: false,
    };
    if (!rates || !parsed) return model;

    const tables = CATEGORIES.filter((key) => rates.tables[key] && Object.keys(rates.tables[key]).length);
    for (const amount of parsed.candidates) {
      const amountText = `${fmt.amount.format(amount)} ${src}`;
      const ctx = { amount, src, dst, fmt };
      const reading = { amount: amountText, sections: [] };
      for (const key of tables) {
        const table = rates.tables[key];
        const label = t(`cat_${key}`);
        const r = convert(amount, src, dst, table, { cashFee: key === "cash" });
        if (!r) {
          const missing = [src, dst].filter((c) => !rateOf(table, c)).join(", ");
          reading.sections.push({ key, label, unavailable: t("noRate", missing) });
          continue;
        }
        if (key === "official") {
          reading.sections.push({ key, label, rows: [resultRow({ key: "official", label: t("officialRow"), short: t("officialRow"), raw: r.get, fee: false }, ctx)] });
          continue;
        }
        if (r.feeGet || r.feePay) model.anyFee = true;
        reading.sections.push({
          key,
          label,
          rows: [
            resultRow({ key: "get", label: t("sellYouGet", amountText), short: t("sellYouGet", src), raw: r.get, fee: r.feeGet }, ctx),
            resultRow({ key: "pay", label: t("buyYouPay", amountText), short: t("buyYouPay", src), raw: r.pay, fee: r.feePay }, ctx),
          ],
        });
      }
      markBest(reading.sections);
      model.readings.push(reading);
    }

    model.dateLine = rates.date ? t("ratesFor", bank.name, rates.time ? `${rates.date} ${rates.time}` : rates.date) : t("ratesOf", bank.name);
    for (const key of tables) {
      const line = rateLine(rates.tables[key], [src, dst], fmt, key === "official");
      if (line) model.rateLines.push(`${t(`short_${key}`)}: ${line}`);
    }
    if (model.anyFee) model.notes.push(t("feeNote"));
    if (bank.noteKey) model.notes.push(t(bank.noteKey));
    return model;
  }

  // Plain-text version for system notifications.
  function modelToText(model, t) {
    if (model.error && !model.readings.length) return model.error;
    if (model.hint && !model.readings.length) return model.hint;
    const lines = [];
    for (const reading of model.readings) {
      if (model.ambiguous) lines.push(t("ifReading", reading.amount));
      for (const s of reading.sections) {
        if (s.unavailable) lines.push(`${s.label}: ${s.unavailable}`);
        else lines.push(`${s.label}: ${s.rows.map((r) => `${r.short} ${r.value}${r.fee ? "*" : ""}`).join(" · ")}`);
      }
    }
    if (model.dateLine) lines.push(model.dateLine);
    return lines.join("\n");
  }

  const api = {
    CASH_FEE,
    CATEGORIES,
    POPULAR,
    localeOf,
    rateOf,
    convert,
    effectiveRate,
    availableCurrencies,
    menuCurrencies,
    currencyName,
    buildModel,
    modelToText,
  };
  root.CurrencyConvert = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
