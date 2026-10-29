// Settings page: the bank whose rates are used, the interface language, and
// the keyboard shortcut. The background script owns the settings and strings.
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

  async function renderShortcut(s) {
    let shortcut = "";
    try {
      const commands = await api.commands.getAll();
      shortcut = (commands.find((c) => c.name === "convert-selection") || {}).shortcut || "";
    } catch (e) {
      // No commands API: leave it unset.
    }
    const keys = shortcut ? shortcut.split("+").map((k) => Object.assign(document.createElement("kbd"), { textContent: k })) : [s.optShortcutNone];
    $("shortcut").replaceChildren(...keys);
  }

  function render(data) {
    const s = data.strings;
    document.documentElement.lang = data.lang;
    document.title = s.optionsTitle;
    $("title").textContent = s.extName;
    $("intro").textContent = s.optIntro;
    $("bank-label").textContent = s.optBank;
    $("lang-label").textContent = s.optLang;
    $("shortcut-label").textContent = s.optShortcut;
    $("shortcut-help").textContent = s.optShortcutHelp;
    $("shortcut-change").textContent = s.optShortcutChange;
    $("about-label").textContent = s.optAbout;
    $("disclaimer").textContent = s.optDisclaimer;
    $("privacy").textContent = s.optPrivacy;
    fill($("bank"), data.banks.map((b) => [b.id, b.name]), data.settings.bank);
    fill($("lang"), [["auto", s.optLangAuto], ...LANGS], data.settings.lang);
    renderShortcut(s);
    return data;
  }

  async function save(settings) {
    const data = render(await api.runtime.sendMessage({ type: "cv-save-settings", settings }));
    $("saved").textContent = data.strings.optSaved;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
  }

  // Firefox has its own shortcut editor; Chrome has a page for it.
  function changeShortcut() {
    if (api.commands && api.commands.openShortcutSettings) api.commands.openShortcutSettings();
    else api.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  $("bank").addEventListener("change", (e) => save({ bank: e.target.value }));
  $("lang").addEventListener("change", (e) => save({ lang: e.target.value }));
  $("shortcut-change").addEventListener("click", changeShortcut);
  api.runtime.sendMessage({ type: "cv-options-data" }).then(render);
})();
