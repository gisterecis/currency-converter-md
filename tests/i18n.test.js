const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, messages, translator } = require("./helpers.js");
const { I18n } = globalThis;

const placeholders = (s) => (s.match(/\$\d/g) || []).sort().join(",");

test("ro, en and ru have the same keys and placeholders", () => {
  const ro = messages("ro");
  for (const lang of ["en", "ru"]) {
    const other = messages(lang);
    assert.deepEqual(Object.keys(other).sort(), Object.keys(ro).sort(), lang);
    for (const k of Object.keys(ro)) assert.equal(placeholders(other[k].message), placeholders(ro[k].message), `${lang} ${k}`);
  }
});

test("only the shipped locales exist", () => {
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "_locales")).sort(), ["en", "ro", "ru"]);
});

test("store limits: name <= 75, description <= 132 characters", () => {
  for (const lang of I18n.LANGS) {
    const m = messages(lang);
    assert.ok(m.extName.message.length <= 75, lang);
    assert.ok(m.extDescription.message.length <= 132, lang);
  }
});

test("every key the code uses exists", () => {
  const ro = messages("ro");
  const files = ["background.js", "lib/convert.js", ...fs.readdirSync(path.join(ROOT, "lib/banks")).map((f) => `lib/banks/${f}`)];
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/\bt\("([A-Za-z_]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/(?:nameKey|noteKey): "([A-Za-z_]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\[([^\]]*)\]/g)) for (const k of m[1].matchAll(/"(opt[A-Za-z]+|boxLabel|close|refresh|settings|bankLabel|fromLabel|toLabel|swap|ambiguousNote|srcGuessed|appName)"/g)) used.add(k[1]);
  }
  for (const key of ["cash", "card", "online", "official"]) used.add(`cat_${key}`).add(`short_${key}`);
  for (const k of used) assert.ok(ro[k], `missing message ${k}`);
});

test("language resolution", () => {
  assert.equal(I18n.resolve("auto", "ro"), "ro");
  assert.equal(I18n.resolve("auto", "ro-MD"), "ro");
  assert.equal(I18n.resolve("auto", "mo"), "ro");
  assert.equal(I18n.resolve("auto", "ru-RU"), "ru");
  assert.equal(I18n.resolve("auto", "en-GB"), "en");
  assert.equal(I18n.resolve("auto", "de"), "ro");
  assert.equal(I18n.resolve("auto", ""), "ro");
  assert.equal(I18n.resolve("ru", "en-US"), "ru");
  assert.equal(I18n.resolve("xx", "en-US"), "en");
});

test("translator substitutes arguments and falls back to Romanian", () => {
  const t = translator("en");
  assert.equal(t("ratesFor", "maib", "29.10.2026"), "maib rates for 29.10.2026");
  const partial = I18n.translator({ hi: { message: "Hi $1" } }, messages("ro"));
  assert.equal(partial("hi", "Ana"), "Hi Ana");
  assert.equal(partial("bankLabel"), "Banca");
  assert.equal(partial("nope"), "nope");
});
