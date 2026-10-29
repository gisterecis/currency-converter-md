// Bank adapters register here. Each one knows how to fetch and read one
// bank's published rates:
//   id, name          stable id (settings, cache key) and display name
//   nameKey           optional i18n key for a longer name in the bank picker
//   pageUrl(lang)     the bank's own rates page, linked from the box
//   requests()        [{ url, type: "text" | "json", marker }]; a text response
//                     without `marker` counts as blocked (bot check)
//   tabFallback       open blocked pages in a background tab so the bot check can pass
//   load(get)         optional custom fetch sequence (default: all requests)
//   parse(bodies)     -> { date, time, tables: { cash, card, online, official } }
//   noteKey           optional i18n key for a footnote (branch, office)
(function (root) {
  "use strict";

  // Shown in this order: largest banks first, the BNM reference rate last.
  const ORDER = ["maib", "micb", "victoriabank", "otp", "procredit", "fincombank", "eximbank", "energbank", "comertbank", "ecb", "bnm"];
  const DEFAULT = "maib";
  const byId = new Map();

  function register(bank) {
    byId.set(bank.id, bank);
    return bank;
  }

  const get = (id) => byId.get(id) || null;
  const all = () => ORDER.map(get).filter(Boolean);

  const api = { ORDER, DEFAULT, register, get, all };
  root.Banks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
