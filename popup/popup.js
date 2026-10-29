// Toolbar converter: type an amount, pick the currencies and the bank. The
// last conversion is remembered between openings.
(async () => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const KEY = "popup:last";

  const data = await api.runtime.sendMessage({ type: "cv-popup-data" });
  document.documentElement.lang = data.lang;
  document.title = data.strings.appName;

  let last = {};
  try {
    last = (await api.storage.local.get(KEY))[KEY] || {};
  } catch (e) {
    // Start from the defaults.
  }
  const request = { selection: last.selection || "100", src: last.src || "EUR", dst: last.dst || "MDL", bank: data.bank };

  const view = globalThis.ConverterView.create({
    mode: "popup",
    strings: data.strings,
    request,
    onRequest(req, { force }) {
      api.storage.local.set({ [KEY]: { selection: req.selection, src: req.src, dst: req.dst } }).catch(() => {});
      return api.runtime.sendMessage({ type: "cv-convert", request: req, force });
    },
    onSettings() {
      api.runtime.openOptionsPage();
      window.close();
    },
  });
  document.getElementById("app").attachShadow({ mode: "open" }).append(view.el);
  view.focusAmount();
  view.send(request);
})();
