#!/usr/bin/env bash
# Builds ready-to-upload packages of Convertor valutar MD:
#   release/<version>/convertor-valutar-md-firefox-<version>.xpi  addons.mozilla.org, or Install Add-on From File
#   release/<version>/convertor-valutar-md-chrome-<version>.zip   Chrome Web Store upload
#   release/<version>/store/                                      listing text, privacy policy, promo tile, screenshots
#   release/<version>/SHA256SUMS
#
# Runs the unit tests and web-ext lint first, then checks what went into each package.
#
# Usage: scripts/package.sh [options]
#   --version X.Y.Z  set the version in manifest.json and package.json first
#   --skip-tests     skip the unit tests and lint
#   --e2e            also run the Firefox and Chrome end-to-end tests (needs firefox, chromium, network)
#   --sign           also have Mozilla sign the Firefox package (unlisted) so regular Firefox installs it;
#                    needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET from addons.mozilla.org/developers/addon/api/key/
#   -h, --help       show this help

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
NAME="convertor-valutar-md"
WEB_EXT="node_modules/.bin/web-ext"

step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
usage() { sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; }

version=""
run_tests=1
run_e2e=0
sign=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || die "--version needs a value, e.g. --version 2.0.1"
      version="$2"
      shift 2
      ;;
    --version=*) version="${1#*=}" && shift ;;
    --skip-tests) run_tests=0 && shift ;;
    --e2e) run_e2e=1 && shift ;;
    --sign) sign=1 && shift ;;
    -h | --help) usage && exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

command -v node >/dev/null || die "node is required (https://nodejs.org)"
command -v npm >/dev/null || die "npm is required"
command -v unzip >/dev/null || die "unzip is required to check the packages"
if [ "$sign" = 1 ] && { [ -z "${WEB_EXT_API_KEY:-}" ] || [ -z "${WEB_EXT_API_SECRET:-}" ]; }; then
  die "--sign needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET (https://addons.mozilla.org/developers/addon/api/key/)"
fi
if [ ! -x "$WEB_EXT" ]; then
  step "Installing dependencies"
  npm ci --no-audit --no-fund
fi

# Chrome and Firefox both want 1-4 dot-separated integers, each at most 65535.
if [ -n "$version" ]; then
  [[ "$version" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]] || die "version must look like 2.0.1 (got '$version')"
  for part in ${version//./ }; do
    [ "$part" -le 65535 ] || die "each version number must be at most 65535 (got '$version')"
  done
  step "Setting version $version"
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync("manifest.json", "utf8");
    if (!/"version"\s*:/.test(text)) throw new Error("manifest.json has no version field");
    fs.writeFileSync("manifest.json", text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${process.argv[1]}$2`));
  ' "$version"
  npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
fi
version="$(node -p 'require("./manifest.json").version')"
OUT="release/$version"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ "$run_tests" = 1 ]; then
  step "Unit tests"
  node --test --test-reporter=dot
  step "Lint (Firefox)"
  if ! lint="$("$WEB_EXT" lint --output=text 2>&1)"; then
    printf '%s\n' "$lint"
    die "web-ext lint found errors"
  fi
  printf '%s\n' "$lint" | grep -E '^(errors|warnings|notices) ' || true
fi

if [ "$run_e2e" = 1 ]; then
  step "End-to-end: Firefox"
  node tests/e2e/run.mjs "$tmp/e2e-firefox"
  step "End-to-end: Chrome"
  node scripts/build.mjs
  node tests/e2e/chrome.mjs "$tmp/e2e-chrome"
fi

step "Building $version into $OUT/"
rm -rf "$OUT"
mkdir -p "$OUT"
"$WEB_EXT" build --overwrite-dest --artifacts-dir "$OUT" --filename "$NAME-firefox-{version}.xpi" >/dev/null
node scripts/build.mjs
"$WEB_EXT" build --source-dir dist/chrome --overwrite-dest --artifacts-dir "$OUT" --filename "$NAME-chrome-{version}.zip" >/dev/null
FIREFOX_PKG="$OUT/$NAME-firefox-$version.xpi"
CHROME_PKG="$OUT/$NAME-chrome-$version.zip"

step "Checking package contents"
node - "$FIREFOX_PKG" "$CHROME_PKG" "$version" <<'EOF'
const { execFileSync } = require("node:child_process");
const [firefoxPkg, chromePkg, version] = process.argv.slice(-3);
const entries = (pkg) => execFileSync("unzip", ["-Z1", pkg], { encoding: "utf8" }).split("\n").filter(Boolean);
const read = (pkg, file) => execFileSync("unzip", ["-p", pkg, file], { encoding: "utf8" });
const problems = [];
const expect = (ok, what) => ok || problems.push(what);

const REQUIRED = ["manifest.json", "LICENSE", "background.js", "content/box.js", "content/chip.js", "options/options.html", "icons/icon-128.png",
  "_locales/ro/messages.json", "_locales/en/messages.json", "_locales/ru/messages.json"];
const FORBIDDEN = /^(tests|scripts|store|docs|dist|release|node_modules|web-ext-artifacts)\/|^(package(-lock)?\.json|manifest\.chrome\.json|README\.md|SECURITY\.md)$/;

for (const [label, pkg] of [["firefox", firefoxPkg], ["chrome", chromePkg]]) {
  const files = entries(pkg);
  const manifest = JSON.parse(read(pkg, "manifest.json"));
  for (const f of REQUIRED) expect(files.includes(f), `${label}: ${f} missing`);
  for (const f of files) expect(!FORBIDDEN.test(f), `${label}: ${f} should not be packaged`);
  expect(manifest.version === version, `${label}: manifest version ${manifest.version}, expected ${version}`);
  expect(manifest.default_locale === "ro", `${label}: default_locale is not ro`);
  const scripts = label === "firefox"
    ? manifest.background.scripts
    : [...read(pkg, manifest.background.service_worker || "sw.js").matchAll(/"([^"]+\.js)"/g)].map((m) => m[1]);
  for (const s of scripts) expect(files.includes(s), `${label}: background script ${s} missing`);
  if (label === "firefox") {
    expect(manifest.browser_specific_settings && manifest.browser_specific_settings.gecko.id, "firefox: no add-on ID");
  } else {
    expect(manifest.background.service_worker === "sw.js" && files.includes("sw.js"), "chrome: sw.js service worker missing");
    expect(!manifest.browser_specific_settings, "chrome: has Firefox-only browser_specific_settings");
    expect(!(manifest.host_permissions || []).includes("<all_urls>"), "chrome: asks for <all_urls>");
  }
  console.log(`${label.padEnd(8)} ${files.filter((f) => !f.endsWith("/")).length} files, ${scripts.length} background scripts, version ${manifest.version}`);
}
if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
EOF

if [ "$sign" = 1 ]; then
  step "Signing the Firefox package with Mozilla (unlisted)"
  "$WEB_EXT" sign --channel=unlisted --artifacts-dir "$OUT/signed"
fi

step "Copying store assets"
mkdir -p "$OUT/store"
cp store/listing.md store/chrome-web-store.md docs/privacy-policy.html store/promo-440x280.png "$OUT/store/"
cp -R store/screenshots "$OUT/store/screenshots"
cp icons/icon-128.png "$OUT/store/icon-128.png"
if grep -q CONTACT_EMAIL docs/privacy-policy.html; then
  warn "docs/privacy-policy.html still has CONTACT_EMAIL placeholders; fill them in before hosting it"
fi

step "Checksums"
node - "$OUT" <<'EOF'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[process.argv.length - 1];
const files = fs.readdirSync(dir, { recursive: true })
  .filter((f) => fs.statSync(path.join(dir, f)).isFile() && f !== "SHA256SUMS")
  .sort();
const lines = files.map((f) => `${crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")}  ${f}`);
fs.writeFileSync(path.join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
console.log(`${files.length} files in SHA256SUMS`);
EOF

step "Done: $OUT/"
for f in "$OUT"/*.xpi "$OUT"/*.zip "$OUT"/signed/*.xpi; do
  [ -f "$f" ] && printf '  %-62s %s\n' "$f" "$(du -h "$f" | cut -f1)"
done
cat <<EOF

  Chrome:  upload $(basename "$CHROME_PKG") at https://chrome.google.com/webstore/devconsole
           (listing text and answers: $OUT/store/chrome-web-store.md)
  Firefox: submit $(basename "$FIREFOX_PKG") at https://addons.mozilla.org/developers/addon/submit/
           or install it from file in Firefox ESR / Developer Edition / Nightly
EOF
