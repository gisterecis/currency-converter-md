// Settings page: the bank whose rates are used and the interface language.
// The background script owns the settings and the strings.
(() => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const LANGS = [
    ["ro", "Română"],
    ["en", "English"],
    ["ru", "Русский"],
  ];
  let savedTimer = null;

  function fill(select, options, value) {
    select.replaceChildren(
      ...options.map(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        o.selected = v === value;
        return o;
      })
    );
  }

  function render(data) {
    const s = data.strings;
    document.documentElement.lang = data.lang;
    document.title = s.optionsTitle;
    $("title").textContent = s.optionsTitle;
    $("intro").textContent = s.optIntro;
    $("bank-label").textContent = s.optBank;
    $("lang-label").textContent = s.optLang;
    $("disclaimer").textContent = s.optDisclaimer;
    $("privacy").textContent = s.optPrivacy;
    fill($("bank"), data.banks.map((b) => [b.id, b.name]), data.settings.bank);
    fill($("lang"), [["auto", s.optLangAuto], ...LANGS], data.settings.lang);
    return data;
  }

  async function save(settings) {
    const data = render(await api.runtime.sendMessage({ type: "cv-save-settings", settings }));
    $("saved").textContent = data.strings.optSaved;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
  }

  $("bank").addEventListener("change", (e) => save({ bank: e.target.value }));
  $("lang").addEventListener("change", (e) => save({ lang: e.target.value }));
  api.runtime.sendMessage({ type: "cv-options-data" }).then(render);
})();
