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

  // Everything the box (or the notification fallback) needs.
  //   selection    the selected text; parsed is its CurrencyParse result
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
      title: `${parsed.text} ${src} → ${dst}`,
      request: { selection, src, dst, bank: bank.id },
      bank: { id: bank.id, name: bank.name },
      banks,
      currencies: availableCurrencies(rates).concat([src, dst]).filter((c, i, a) => a.indexOf(c) === i).map((code) => ({ code, name: currencyName(code, lang) })),
      srcGuessed,
      ambiguous: parsed.ambiguous,
      readings: [],
      error: error ? t("errLoad", error) : null,
      stale: stale ? t("staleNote", bank.name) : null,
      footer: [],
      link: { href: bank.pageUrl(lang), text: t("openBankPage", bank.name) },
      anyFee: false,
    };
    if (!rates) return model;

    const tables = CATEGORIES.filter((key) => rates.tables[key] && Object.keys(rates.tables[key]).length);
    for (const amount of parsed.candidates) {
      const amountText = `${fmt.amount.format(amount)} ${src}`;
      const reading = { amount: amountText, sections: [] };
      for (const key of tables) {
        const table = rates.tables[key];
        const label = t(`cat_${key}`);
        const cashFee = key === "cash";
        const r = convert(amount, src, dst, table, { cashFee });
        if (!r) {
          const missing = [src, dst].filter((c) => !rateOf(table, c)).join(", ");
          reading.sections.push({ key, label, unavailable: t("noRate", missing) });
          continue;
        }
        if (key === "official") {
          reading.sections.push({ key, label, rows: [{ key: "official", label: t("officialRow"), short: t("officialRow"), value: `${fmt.money.format(r.get)} ${dst}`, fee: false }] });
          continue;
        }
        if (r.feeGet || r.feePay) model.anyFee = true;
        reading.sections.push({
          key,
          label,
          rows: [
            { key: "get", label: t("sellYouGet", amountText), short: t("sellYouGet", src), value: `${fmt.money.format(r.get)} ${dst}`, fee: r.feeGet },
            { key: "pay", label: t("buyYouPay", amountText), short: t("buyYouPay", src), value: `${fmt.money.format(r.pay)} ${dst}`, fee: r.feePay },
          ],
        });
      }
      model.readings.push(reading);
    }

    const date = rates.date ? t("ratesFor", bank.name, rates.time ? `${rates.date} ${rates.time}` : rates.date) : t("ratesOf", bank.name);
    const updated = fetchedAt ? ` · ${t("updatedAt", new Date(fetchedAt).toLocaleTimeString(fmt.locale, { hour: "2-digit", minute: "2-digit" }))}` : "";
    model.footer.push(date + updated);
    for (const key of tables) {
      const line = rateLine(rates.tables[key], [src, dst], fmt, key === "official");
      if (line) model.footer.push(`${t(`short_${key}`)}: ${line}`);
    }
    if (model.anyFee) model.footer.push(t("feeNote"));
    if (bank.noteKey) model.footer.push(t(bank.noteKey));
    return model;
  }

  // Plain-text version for system notifications.
  function modelToText(model, t) {
    if (model.error && !model.readings.length) return model.error;
    const lines = [];
    for (const reading of model.readings) {
      if (model.ambiguous) lines.push(t("ifReading", reading.amount));
      for (const s of reading.sections) {
        if (s.unavailable) lines.push(`${s.label}: ${s.unavailable}`);
        else lines.push(`${s.label}: ${s.rows.map((r) => `${r.short} ${r.value}${r.fee ? "*" : ""}`).join(" · ")}`);
      }
    }
    if (model.footer.length) lines.push(model.footer[0]);
    return lines.join("\n");
  }

  const api = {
    CASH_FEE,
    CATEGORIES,
    POPULAR,
    localeOf,
    rateOf,
    convert,
    availableCurrencies,
    menuCurrencies,
    currencyName,
    buildModel,
    modelToText,
  };
  root.CurrencyConvert = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
