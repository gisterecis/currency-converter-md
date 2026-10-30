const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, manifest } = require("./helpers.js");
const { Banks } = globalThis;

const chrome = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.chrome.json"), "utf8"));

function matches(pattern, url) {
  const m = /^(https?):\/\/([^/*]+)\/\*$/.exec(pattern);
  const u = new URL(url);
  return !!m && u.protocol === `${m[1]}:` && u.hostname === m[2];
}

test("host permissions cover every bank request and page", () => {
  for (const m of [chrome, manifest]) {
    for (const bank of Banks.all()) {
      const urls = [...bank.requests().map((r) => r.url), bank.pageUrl("ro")];
      for (const url of urls) assert.ok(m.host_permissions.some((p) => matches(p, url)), `${bank.id}: ${url}`);
    }
  }
});

// One exact host per bank: no wildcard subdomains, which would also cover the
// banks' internet banking sites.
test("both browsers ask only for each bank's rates host, not every site or subdomain", () => {
  for (const m of [chrome, manifest]) {
    for (const p of m.host_permissions) assert.match(p, /^https:\/\/[a-z0-9.-]+\/\*$/, p);
    assert.equal(m.host_permissions.length, Banks.ORDER.length);
    assert.ok(m.permissions.includes("activeTab"));
  }
  assert.deepEqual(manifest.host_permissions, chrome.host_permissions);
});

test("every bank file is a background script, after the registry and before rates.js", () => {
  const scripts = manifest.background.scripts;
  const files = fs.readdirSync(path.join(ROOT, "lib/banks")).map((f) => `lib/banks/${f}`);
  for (const f of files) assert.ok(scripts.includes(f), f);
  const registry = scripts.indexOf("lib/banks/registry.js");
  for (const f of files) if (f !== "lib/banks/registry.js") assert.ok(scripts.indexOf(f) > registry, f);
  assert.ok(scripts.indexOf("lib/rates.js") > Math.max(...files.map((f) => scripts.indexOf(f))));
  for (const s of scripts) assert.ok(fs.existsSync(path.join(ROOT, s)), s);
});

test("both manifests share name, locale, options page, toolbar popup, shortcut and icons", () => {
  for (const k of ["name", "description", "default_locale", "options_ui", "action", "commands"]) assert.deepEqual(chrome[k], manifest[k], k);
  assert.ok(fs.existsSync(path.join(ROOT, manifest.action.default_popup)));
  for (const icon of Object.values(manifest.action.default_icon)) assert.ok(fs.existsSync(path.join(ROOT, icon)), icon);
  for (const icon of [...Object.values(chrome.icons), ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(path.join(ROOT, icon)), icon);
  }
  assert.ok(chrome.icons["128"], "Chrome Web Store needs a 128px icon");
});
