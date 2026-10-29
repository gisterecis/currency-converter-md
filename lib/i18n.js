// UI strings. They live in _locales/<lang>/messages.json (Chrome's format, so
// the manifest can use them too), but the language is our own setting rather
// than the browser's, so they're loaded here instead of via i18n.getMessage.
(function (root) {
  "use strict";

  const LANGS = ["ro", "en", "ru"];
  const DEFAULT = "ro";

  // "auto" follows the browser UI language: ro / ro-MD / mo -> ro, ru-* -> ru,
  // en-* -> en, anything else -> Romanian.
  function resolve(setting, uiLanguage) {
    if (LANGS.includes(setting)) return setting;
    const base = String(uiLanguage || "").toLowerCase().split(/[-_]/)[0];
    if (base === "mo") return "ro";
    return LANGS.includes(base) ? base : DEFAULT;
  }

  // messages.json -> t(key, ...args); "$1".."$9" take the arguments.
  function translator(messages, fallback = {}) {
    return (key, ...args) => {
      const entry = messages[key] || fallback[key];
      if (!entry) return key;
      return entry.message.replace(/\$(\d)/g, (m, n) => (args[n - 1] !== undefined ? String(args[n - 1]) : m));
    };
  }

  const loaded = new Map();

  function messagesFor(lang) {
    if (!loaded.has(lang)) {
      const url = root.Ext.api.runtime.getURL(`_locales/${lang}/messages.json`);
      loaded.set(lang, fetch(url).then((r) => r.json()));
    }
    return loaded.get(lang);
  }

  async function load(setting) {
    const ui = root.Ext.api.i18n && root.Ext.api.i18n.getUILanguage ? root.Ext.api.i18n.getUILanguage() : "";
    const lang = resolve(setting, ui);
    const [messages, fallback] = await Promise.all([messagesFor(lang), messagesFor(DEFAULT)]);
    return { lang, t: translator(messages, fallback) };
  }

  const api = { LANGS, DEFAULT, resolve, translator, load };
  root.I18n = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
