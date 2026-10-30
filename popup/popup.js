// Toolbar converter: type an amount, pick the currencies and the bank. The
// last conversion is remembered between openings. On Android it starts from
// the amount selected in the page and offers the button under selections.
(async () => {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  const KEY = "popup:last";
  const ALL_SITES = { origins: ["*://*/*"] }; // What the button needs (background.js).

  async function showOffer({ text, button }) {
    if (await api.permissions.contains(ALL_SITES).catch(() => true)) return;
    const offer = document.getElementById("offer");
    const on = document.getElementById("offer-on");
    document.getElementById("offer-text").textContent = text;
    on.textContent = button;
    // request() has to run straight from the tap. The background registers the button.
    on.addEventListener("click", () => {
      api.permissions.request(ALL_SITES).then((granted) => (offer.hidden = granted), () => {});
    });
    offer.hidden = false;
  }

  const [data, platform] = await Promise.all([
    api.runtime.sendMessage({ type: "cv-popup-data" }),
    api.runtime.getPlatformInfo().catch(() => ({})),
  ]);
  const android = platform.os === "android";
  document.documentElement.lang = data.lang;
  document.documentElement.classList.toggle("android", android);
  document.title = data.strings.appName;

  let last = {};
  try {
    last = (await api.storage.local.get(KEY))[KEY] || {};
  } catch (e) {
    // Start from the defaults.
  }
  const request = data.selection
    ? { ...data.selection, bank: data.bank }
    : { selection: last.selection || "100", src: last.src || "EUR", dst: last.dst || "MDL", bank: data.bank };

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
  // On a phone the keyboard would cover the results.
  if (!android) view.focusAmount();
  view.send(request);
  if (data.offer) showOffer(data.offer);
})();
