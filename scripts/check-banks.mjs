// Fetches every bank's rates live with the extension's adapters and prints
// what they read. Run it when a bank shows "page layout changed", then fix
// lib/banks/<id>.js and refresh tests/fixtures/banks/.
// Usage: node scripts/check-banks.mjs [bankId ...]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
for (const s of manifest.background.scripts.filter((f) => f.startsWith("lib/"))) require(path.join(ROOT, s));
const { Banks, Scrape } = globalThis;

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

async function get(req) {
  const res = await fetch(req.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Scrape.RateError(res.status === 571 ? "busy" : "http", String(res.status), { status: res.status });
  if (req.type === "json") return res.json();
  const body = await res.text();
  if (req.marker && !body.includes(req.marker)) throw new Scrape.RateError("blocked", "bot check (works in the browser via a background tab)");
  return body;
}

const ids = process.argv.slice(2);
const banks = Banks.all().filter((b) => !ids.length || ids.includes(b.id));
let failed = 0;

for (const bank of banks) {
  const t0 = Date.now();
  try {
    const bodies = bank.load ? await bank.load(get, bank) : await Promise.all(bank.requests().map(get));
    const r = bank.parse(bodies);
    const ok = Object.values(r.tables).some(Scrape.hasRates);
    if (!ok) throw Scrape.layoutError("no rates");
    const tables = Object.entries(r.tables)
      .map(([k, t]) => {
        const eur = t.EUR ? ` EUR ${t.EUR.buy}/${t.EUR.sell}` : "";
        return `${k}[${Object.keys(t).length}]${eur}`;
      })
      .join("  ");
    console.log(`OK   ${bank.id.padEnd(13)} ${(r.date || "no date").padEnd(10)} ${(r.time || "").padEnd(5)} ${tables}  (${Date.now() - t0} ms)`);
  } catch (e) {
    const soft = e.code === "blocked" && bank.tabFallback;
    if (!soft) failed++;
    console.log(`${soft ? "SKIP" : "FAIL"} ${bank.id.padEnd(13)} ${e.code || ""} ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
