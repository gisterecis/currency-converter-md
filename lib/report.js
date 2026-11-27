// Anonymous error reports, so the developer hears about a bank that changed its
// page before users do. Only when a bank's rates can't be read. On by default,
// and the user can turn them off: Firefox asks with its built-in data consent
// (technicalAndInteraction, on by default in the install prompt, and in
// about:addons); browsers without it (Chrome) have a switch on the options page.
//
// A report is one plain HTTPS request to Sentry's envelope endpoint, carrying
// the bank, the kind of error, and the extension and browser versions. Never
// the selected text, the page, the amount or anything else about the user.
(function (root) {
  "use strict";

  // Public by design: a Sentry DSN only lets you send events to the project.
  // Empty turns reporting off (and hides the setting).
  const DSN = "https://43a2d7b0080a02152aae560e32f4d21e@o4512505378439168.ingest.de.sentry.io/4512505432440912";
  const DATA_PERMISSION = { data_collection: ["technicalAndInteraction"] };
  // Failures worth a report: the page changed, moved, or stopped letting
  // browsers through. Not "network" (offline) or "busy" (rate limits).
  const CODES = new Set(["layout", "http", "blocked", "timeout", "generic"]);
  // The same bank, error and version is reported at most once a day per install.
  const REPEAT_MS = 24 * 60 * 60 * 1000;
  const SENT_KEY = "reports:sent";

  const ext = () => root.Ext && root.Ext.api;

  // "https://<key>@o1.ingest.de.sentry.io/<project>" -> where to send and with which key.
  function parseDsn(dsn) {
    const m = /^https:\/\/([0-9a-f]+)@([a-z0-9.-]+)\/(\d+)$/i.exec(String(dsn || "").trim());
    return m ? { key: m[1], url: `https://${m[2]}/api/${m[3]}/envelope/?sentry_key=${m[1]}&sentry_version=7` } : null;
  }

  // true/false from Firefox's data consent, or null where the browser has none.
  async function builtInConsent() {
    const perms = ext() && ext().permissions;
    if (!perms || !perms.getAll) return null;
    const all = await perms.getAll();
    if (!all || !("data_collection" in all)) return null;
    return (all.data_collection || []).includes("technicalAndInteraction");
  }

  async function settingConsent() {
    const area = ext().storage.sync || ext().storage.local;
    const { reportErrors } = await area.get({ reportErrors: true });
    return reportErrors !== false;
  }

  // { available, builtIn, enabled } for the options page.
  async function status(dsn = DSN) {
    const available = !!parseDsn(dsn);
    let builtIn = null;
    try {
      builtIn = await builtInConsent();
    } catch (e) {
      // No permissions API here: fall back to the setting.
    }
    let enabled = false;
    if (available) {
      try {
        enabled = builtIn !== null ? builtIn : await settingConsent();
      } catch (e) {
        enabled = false;
      }
    }
    return { available, builtIn: builtIn !== null, enabled };
  }

  function browserInfo(ua = (root.navigator && root.navigator.userAgent) || "") {
    // Edge, Brave and Opera report as Chrome, which is what they run.
    const m = /(Firefox|Chrome)\/(\d+)/.exec(ua);
    return { name: m ? m[1] : "unknown", version: m ? m[2] : "", mobile: /Android|Mobile/.test(ua) };
  }

  function extVersion() {
    try {
      return ext().runtime.getManifest().version;
    } catch (e) {
      return "unknown";
    }
  }

  const uuid = () =>
    root.crypto && root.crypto.randomUUID
      ? root.crypto.randomUUID().replace(/-/g, "")
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

  // The Sentry event for one bank failure. Nothing in it comes from the page
  // the user is on: the detail is the adapter's own message or the bank's URL.
  function buildEvent(bankId, error, { version = extVersion(), browser = browserInfo(), now = Date.now() } = {}) {
    const code = (error && error.code) || "generic";
    const detail = String((error && (error.detail || error.message)) || "").slice(0, 200);
    return {
      event_id: uuid(),
      timestamp: now / 1000,
      platform: "javascript",
      level: code === "layout" ? "error" : "warning",
      logger: "rates",
      release: `convertor-valutar-md@${version}`,
      environment: "production",
      message: { formatted: `${bankId}: ${code}${detail ? ` (${detail})` : ""}` },
      // One Sentry issue per bank and kind of error, whatever the detail says.
      fingerprint: ["bank-failure", bankId, code],
      tags: { bank: bankId, code, browser: browser.name, browser_version: browser.version, mobile: String(browser.mobile) },
      // Tell Sentry not to derive the user's IP address from the request.
      sdk: { name: "convertor-valutar-md.report", version, settings: { infer_ip: "never" } },
    };
  }

  function envelope(event, dsn) {
    const header = { event_id: event.event_id, sent_at: new Date(event.timestamp * 1000).toISOString(), dsn };
    return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
  }

  // Whether this bank/error/version went out in the last day; records it if not.
  async function firstToday(key, now) {
    const { [SENT_KEY]: sent = {} } = await ext().storage.local.get(SENT_KEY);
    if (sent[key] && now - sent[key] < REPEAT_MS) return false;
    const fresh = Object.fromEntries(Object.entries(sent).filter(([, t]) => now - t < REPEAT_MS));
    fresh[key] = now;
    await ext().storage.local.set({ [SENT_KEY]: fresh });
    return true;
  }

  // Called when fetching a bank's rates failed. Never throws, never waits on
  // the network for the caller: reporting must not slow down or break a conversion.
  async function bankFailure(bankId, error, { dsn = DSN, now = Date.now() } = {}) {
    try {
      const target = parseDsn(dsn);
      const code = (error && error.code) || "generic";
      if (!target || !CODES.has(code)) return false;
      if (!(await status(dsn)).enabled) return false;
      const version = extVersion();
      if (!(await firstToday(`${bankId}:${code}:${version}`, now))) return false;
      const body = envelope(buildEvent(bankId, error, { version, now }), dsn);
      // text/plain keeps it a simple request: no CORS preflight, no cookies.
      await fetch(target.url, { method: "POST", body, credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" } });
      return true;
    } catch (e) {
      return false;
    }
  }

  const api = { DSN, DATA_PERMISSION, CODES, parseDsn, status, browserInfo, buildEvent, envelope, bankFailure };
  root.ErrorReport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
