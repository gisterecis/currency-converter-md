# Convertor valutar MD (Currency Converter MD)

A browser extension for Firefox (desktop and Android) and Chrome. Select an amount on any page, right-click (on
Android, open it from the Firefox menu), and convert it at the exchange rates of your Moldovan bank. The result
opens in a small box next to the selection. For each of the bank's rate types (cash at branches, card operations
and, where the bank publishes it, online/app), it shows what you get when you sell the amount and what you pay when
you buy it.

The interface is in Romanian (the default), English and Russian.

## Banks

All 10 banks licensed by the BNM (October 2026), plus the BNM official rate:

| Bank | Rates | Source |
| --- | --- | --- |
| maib | cash, card | `maib.md/ro/curs-valutar` (behind a bot check, see below) |
| Moldindconbank | cash, card | `micb.md` homepage |
| Victoriabank | cash, online | JSON API behind `victoriabank.md/curs-valutar` |
| OTP Bank | cash, card | `otpbank.md/exchange` |
| ProCredit Bank | cash, card | `procreditbank.md/ro/schimb_valutar` (rate-limited, so the cache matters) |
| FinComBank | cash (branch nr. 3), card | `fincombank.com/ro/curs-valutar…` |
| Eximbank | cash, card | `eximbank.md/ro/exchange` (behind a bot check) |
| Energbank | cash, card, online (SMART CURS) | JSON API behind `energbank.com` |
| Comerțbank | cash, card | `comertbank.md` homepage |
| EuroCreditBank | cash, card | `ecb.md` homepage |
| BNM (official rate) | 40 currencies, no buy/sell spread | `bnm.md` XML feed |

Rates are cached for one hour; ⟳ fetches fresh ones. Cash results include the 0.1% fee on buying foreign cash (Law
827-XIV), and those values are marked with `*`.

Rate requests go without cookies, so they never carry an internet banking session. The only exceptions are maib and
Eximbank, which sit behind Imperva bot checks: the extension fetches their page with the check's cookies for that
site. If that's blocked, it opens the page in a background tab for a second or two so the check can pass, reads the
tables, and closes the tab.

The extension asks for one exact host per bank (`www.maib.md`, `micb.md`, …), the one its public rate page is on.
Browsers ignore the path in a host permission, so a single page can't be requested, but leaving out wildcard
subdomains keeps the banks' other subdomains, where internet banking usually lives, out of reach.

## Using it

- **Firefox** rebuilds the menu around the selection. With a currency detected (`1.234,56 €`, `$1,250`,
  `7 500 lei`, `100 грн`, `100 dolari`), it shows **Convertește 1.234,56 EUR în ▸** and the target currencies, plus
  **Altă valută sursă ▸** in case the detection is wrong (for example `lei` meaning RON). With no currency, it shows
  **Convertește 1 250,50 din ▸** so you pick the source first.
- **Chrome** can't change the menu per selection, so it always shows **Convertește „…” în ▸** and the target
  currencies. The box detects the source currency. When it can't, it guesses (MDL, or EUR when converting to MDL)
  and asks you to pick it.
- **Firefox for Android** has no context menu or keyboard shortcuts for add-ons. Select an amount and open the
  converter from the Firefox menu under **Extensions**: it starts from the selection (opening it grants
  `activeTab`). The popup and the settings page also offer an optional button under selected amounts
  (`⇄ 1.234,56 EUR`); tapping it opens the box, converting as the keyboard shortcut does. The button needs access
  to every site, so it's an optional permission that's only requested when you turn it on; without it, nothing
  runs in your pages. It only appears for a bare number or a number with a currency, not for any text that
  contains a digit. The box and the button keep their size when the page is pinch-zoomed.
- **The result box:**
  - Large tiles show what you get selling and pay buying, for each rate type. Each tile includes the effective
    rate ("1 EUR = 19,90 MDL"), and a **best** tag marks the better option.
  - Click a tile to copy the number. You can edit the amount right in the box.
  - The pickers change the bank, the source and the target currency; a bank picked here becomes your default. ⇄
    swaps the currencies, ⚙ opens settings, ⟳ refreshes the rates.
  - Drag the box by its header. Esc, a click outside or × closes it.
  - The bank's published buy/sell rates are folded under "Cursul publicat".
- **Toolbar button:** opens the same converter without selecting anything. It remembers the last amount and
  currencies.
- **Keyboard shortcut** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>: converts the selection without the menu. Lei
  go to the foreign currency you used last; anything else goes to lei. With nothing selected, it opens the toolbar
  converter. You can change the shortcut from the settings page.
- **Settings** (⚙, the menu's last item, or the browser's extension settings):
  - The bank.
  - The language: Automatic follows the browser and falls back to Romanian; or pick Română, English or Русский.
- **Number formats** it understands: `1.234,56`, `1,234.56`, `1 234,56` (including non-breaking and narrow spaces),
  `1'234.50`, and a leading `-`. For ambiguous separators (`1,234` or `1.500`) the box offers both readings to
  pick from.
- **Pages where extensions can't draw** (PDF viewer, `about:`/`chrome://` pages, the add-on stores): the result
  appears as a system notification instead.

## Install

**Chrome / Edge / Brave:** once it's published, install it from the Chrome Web Store. Until then, run
`npm run build:chrome`, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick
`dist/chrome`.

**Firefox:** Firefox ESR, Developer Edition and Nightly can install unsigned add-ons:
1. Run `npm run build:firefox`.
2. Set `xpinstall.signatures.required` to `false` in `about:config`.
3. In `about:addons`, click ⚙, choose **Install Add-on From File…** and pick
   `web-ext-artifacts/convertor-valutar-md-firefox-<version>.xpi`.

For regular Firefox, have Mozilla sign it with
`WEB_EXT_API_KEY='user:…' WEB_EXT_API_SECRET='…' npm run sign` (unlisted), or submit the `.xpi` to
addons.mozilla.org as a listed add-on. The add-on ID is unchanged from 1.x, so the install upgrades in place.

**Firefox for Android** (142 or later): once it's listed on addons.mozilla.org with Android compatibility ticked,
install it from there. To try a development copy on a phone, turn on USB debugging (Android developer options) and
**Remote debugging via USB** (Firefox ⋮ → Settings), connect the phone, then run `adb devices` and
`ANDROID_DEVICE=<id> npm run start:android`. Use `FIREFOX_APK=org.mozilla.fenix` for Nightly.

## Development

```bash
npm install
npm test                 # unit tests: parser, conversion, every bank adapter against saved pages, i18n, manifests,
                         #   and the background without menus/commands, as on Firefox for Android
npm run check-banks      # fetch every bank live and print what the adapters read
npm run e2e              # headless Firefox: live rates, tab fallback, menus, settings, box in ro/en/ru, notification,
                         #   the Android selection button
npm run e2e:chrome       # headless Chromium: same for the Chrome build, including bank switching inside the box,
                         #   plus an emulated phone: selection button, touch, pinch-zoom, a desktop-only site
npm run lint             # web-ext lint (Firefox)
npm run build            # web-ext-artifacts/convertor-valutar-md-{firefox-<v>.xpi,chrome-<v>.zip}
npm start                # Firefox with the add-on and tests/manual.html
npm run start:chrome     # Chromium with dist/chrome
npm run start:android    # Firefox for Android over adb (see Install)
npm run store:screenshots  # regenerate store/screenshots/ (1280×800, ro/en/ru)
```

The repo root is the Firefox add-on. `scripts/build.mjs` builds the Chrome version in `dist/chrome`:
- it uses `manifest.chrome.json`, with the version taken from `manifest.json`;
- it adds a service worker `sw.js` that `importScripts()` the same files listed in `manifest.json`
  `background.scripts`.

| File | Purpose |
| --- | --- |
| `lib/parse.js` | selection text → amount(s) and currency |
| `lib/convert.js` | conversion math and the localised view model for the box |
| `lib/banks/*.js` | one adapter per bank: what to fetch and how to read it (`registry.js` documents the shape) |
| `lib/scrape.js` | string helpers for adapters (Chrome's service worker has no `DOMParser`) |
| `lib/rates.js` | fetching, the one-hour cache, the background-tab fallback |
| `lib/i18n.js`, `_locales/` | ro/en/ru strings and language choice |
| `lib/ext.js` | Firefox/Chrome API differences |
| `background.js` | menus, settings, results to the box or a notification |
| `lib/view.js` | the converter UI shared by the box and the toolbar popup |
| `content/box.js` | places the box next to the selection (Shadow DOM), injected only when you convert |
| `content/chip.js` | Firefox for Android: the optional button under a selected amount (registered once allowed) |
| `popup/` | toolbar converter |
| `options/` | settings page |
| `store/` | Chrome Web Store listing text, promo tile, screenshots, submission notes |
| `docs/` | the privacy policy, published by GitHub Pages at https://gisterecis.github.io/currency-converter-md/privacy-policy.html |

### When a bank changes its site

The box will say "pagina … s-a schimbat" (the page layout changed). To fix it:
1. Run `npm run check-banks <id>` to see what fails.
2. Update `lib/banks/<id>.js`.
3. Replace the trimmed copy in `tests/fixtures/banks/` and the expected values in `tests/banks.test.js`.

## Publishing

```bash
scripts/package.sh                    # test, lint, build and check both packages
scripts/package.sh --version 2.0.1    # set the version first (manifest.json + package.json)
scripts/package.sh --e2e              # also run both browser end-to-end tests
scripts/package.sh --sign             # also get a Mozilla-signed .xpi (needs WEB_EXT_API_KEY / WEB_EXT_API_SECRET)
```

Everything to upload ends up in `release/<version>/`:
- the Firefox `.xpi` and the Chrome `.zip`;
- `store/`, with the listing text, privacy policy, promo tile and screenshots;
- `SHA256SUMS`.

The script also checks that each package has the right manifest and every background script, and that no tests or
store files slipped in. `npm run package` runs the same script.

`store/chrome-web-store.md` has the submission steps, the single-purpose statement, the permission justifications
and the privacy answers. `store/listing.md` has the listing text in all three languages. Both versions ask for the
same permissions (Firefox's `menus` is Chrome's `contextMenus`): the 11 bank sites plus `activeTab`, so the
justifications there also answer addons.mozilla.org reviewers. Firefox also lists every site as an optional
permission, requested only on Android when you turn on the selection button.

## License

MIT, see [LICENSE](LICENSE). The exchange rates belong to the banks and the National Bank of Moldova; the
extension only shows what they publish.
