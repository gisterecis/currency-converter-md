// Loads the extension's library scripts into this Node process the way the
// background page does: in manifest order, as globals.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const LIB_SCRIPTS = manifest.background.scripts.filter((s) => s.startsWith("lib/"));

for (const s of LIB_SCRIPTS) require(path.join(ROOT, s));

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const bankFixture = (name) => fixture(path.join("banks", name));
const messages = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, "_locales", lang, "messages.json"), "utf8"));
const translator = (lang) => globalThis.I18n.translator(messages(lang), messages("ro"));

module.exports = { ROOT, manifest, LIB_SCRIPTS, fixture, bankFixture, messages, translator };
