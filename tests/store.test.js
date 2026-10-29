const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, messages } = require("./helpers.js");

// store/listing.md: per language, three ```text boxes (name, summary,
// description) that are pasted into the store forms exactly as written.
const LANGS = { "Română": "ro", English: "en", "Русский": "ru" };
const listing = fs.readFileSync(path.join(ROOT, "store", "listing.md"), "utf8");
const sections = {};
for (const part of listing.split(/^## /m).slice(1)) {
  const heading = part.slice(0, part.indexOf("\n"));
  const lang = Object.entries(LANGS).find(([name]) => heading.startsWith(name));
  if (lang) sections[lang[1]] = [...part.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}

test("listing has name, summary and description for ro, en and ru", () => {
  assert.deepEqual(Object.keys(sections).sort(), ["en", "ro", "ru"]);
  for (const [lang, boxes] of Object.entries(sections)) assert.equal(boxes.length, 3, lang);
});

test("listing name and summary match the package", () => {
  for (const [lang, [name, summary]] of Object.entries(sections)) {
    assert.equal(name, messages(lang).extName.message, `${lang} name`);
    assert.equal(summary, messages(lang).extDescription.message, `${lang} summary`);
  }
});

test("descriptions paste cleanly: whole sentences per line, no Markdown", () => {
  for (const [lang, [, , description]] of Object.entries(sections)) {
    for (const line of description.split("\n")) {
      if (!line) continue;
      // A line that doesn't end a sentence means a paragraph was wrapped.
      assert.match(line, /[.:;!?»”")]$/, `${lang}: wrapped line "${line.slice(-40)}"`);
      assert.doesNotMatch(line, /\*\*|^#|`|^- /, `${lang}: Markdown in "${line.slice(0, 40)}"`);
    }
    assert.ok(description.length <= 16000, `${lang}: Chrome Web Store allows 16 000 characters`);
  }
});
