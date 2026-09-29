# Currency Converter (maib rates) for Firefox

Select an amount on any page, right-click, and convert it at the exchange rates published on
[maib.md/ro/curs-valutar](https://www.maib.md/ro/curs-valutar). The result opens in a small box next to the
selection. It shows **cash at branches** and **card operations** rates, and for each one what you get when you
sell the amount and what you pay when you buy it.

## Using it

- **Currency detected** (`1.234,56 €`, `$1,250`, `7 500 lei`, `100 грн`): the menu shows **Convert 1.234,56 EUR to ▸**
  followed by the target currencies. If the detection is wrong (for example `lei` meaning RON), use
  **Treat as another currency ▸**.
- **No currency** (`1 250,50`): the menu shows **Convert 1 250,50 from ▸** so you can pick the source, then the target.
- **Ambiguous separators** (`1,234` or `1.500`): the box shows both readings side by side (1234 and 1.234).
- **Number formats** it understands: `1.234,56`, `1,234.56`, `1 234,56` (including non-breaking and narrow spaces),
  `1'234.50`, and a leading `-`.
- **Closing the box:** Esc, a click outside it, or ×. ⟳ fetches fresh rates.
- **Pages where add-ons can't draw** (the PDF viewer, `about:` pages, addons.mozilla.org): the result appears as a
  system notification instead.

Rates are cached for one hour. Cash results include maib's 0.1% fee on buying foreign cash; those values are marked
with `*`. The card table only has EUR and USD, so other currencies show "No … rate" there.

maib.md is behind a bot check (Imperva Incapsula). The add-on first fetches the page with your browser's maib.md
cookies. If that's blocked, it opens the page in a background tab for a second or two so the check can pass, reads
the tables, and closes the tab.

## Install (unsigned, Firefox ESR)

Firefox ESR, Developer Edition and Nightly can install unsigned add-ons. Regular release Firefox can't.

1. Build the package (or use the one already in `web-ext-artifacts/`):
   ```bash
   npm install && npm run build
   ```
   This creates `web-ext-artifacts/maib-converter-<version>.xpi`.
2. Open `about:config` and set `xpinstall.signatures.required` to `false`.
3. Open `about:addons`, click ⚙, choose **Install Add-on From File…**, and pick the `.xpi`. Then click **Add**.

It stays installed across restarts. To update, bump `version` in `manifest.json`, run `npm run build`, and install
the new `.xpi` the same way.

Turning off `xpinstall.signatures.required` lets Firefox install any unsigned add-on, not just this one. If you'd
rather keep the check on, you can have Mozilla sign the add-on privately instead (it isn't listed publicly). Create API
credentials at https://addons.mozilla.org/developers/addon/api/key/, then run
`WEB_EXT_API_KEY='user:…' WEB_EXT_API_SECRET='…' npm run sign`.

## Development

```bash
npm test          # unit tests: parsing, conversion, rate-table parsing
npm run e2e       # headless Firefox ESR: live maib fetch, bot-check fallback, menus, box, notification
npm run lint      # web-ext lint
npm start         # opens Firefox ESR with the add-on and tests/manual.html
npm run build     # unsigned .xpi in web-ext-artifacts/
```

| File | Purpose |
| --- | --- |
| `lib/parse.js` | selection text → amount(s) and currency |
| `lib/convert.js` | conversion math and the view model for the box |
| `lib/rates.js` | reads the `#one-one-new` (cash) and `#two-new` (card) tables from the maib page |
| `background.js` | context menu, rate fetching and caching, sends results to the box |
| `content/box.js` | the floating result box (Shadow DOM), injected only when you convert |

If maib redesigns the page, the box says "maib page layout changed". Update the IDs in `lib/rates.js` and the
fixture in `tests/fixtures/`.
