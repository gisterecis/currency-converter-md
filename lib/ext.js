// The few places where Firefox and Chrome differ: the API namespace, the
// context menu API, and async message replies.
(function (root) {
  "use strict";

  const firefox = typeof root.browser !== "undefined";
  const api = firefox ? root.browser : root.chrome;
  // Undefined in Firefox for Android, which has no context menus for add-ons.
  const menus = api && (api.menus || api.contextMenus);

  const Ext = {
    api,
    menus,
    // Firefox can rebuild the menu around the selection when it opens; Chrome can't.
    smartMenus: !!(firefox && api.menus && api.menus.onShown),

    // Chrome (before 148) ignores promises returned from onMessage listeners,
    // so reply through sendResponse. `handler` returns undefined to ignore a message.
    onMessage(handler) {
      api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        const result = handler(msg, sender);
        if (result === undefined) return false;
        Promise.resolve(result).then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
        return true;
      });
    },

    createMenu(props) {
      return menus.create(props, () => void api.runtime.lastError);
    },

    removeAllMenus() {
      if (firefox) return menus.removeAll();
      return new Promise((resolve) => menus.removeAll(() => resolve(void api.runtime.lastError)));
    },
  };

  root.Ext = Ext;
})(typeof globalThis !== "undefined" ? globalThis : this);
