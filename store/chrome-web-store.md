# Publishing on the Chrome Web Store

The package is `release/<version>/convertor-valutar-md-chrome-<version>.zip` (`scripts/package.sh`, which also
tests, lints and checks it; `npm run build:chrome` alone puts it in `web-ext-artifacts/`). Run
`scripts/package.sh --e2e` before each upload.

## One-time setup (you)

1. Register a developer account at https://chrome.google.com/webstore/devconsole (one-time US$5 fee) and verify
   the contact email.
2. The privacy policy is `docs/privacy-policy.html` (contact: gisterecis@moldchem.com). GitHub Pages publishes it from
   `docs/` on `main` at https://gisterecis.github.io/currency-converter-md/privacy-policy.html; edits go live a minute after they're merged.

## New item

1. **Package:** upload the zip.
2. **Store listing:** text from `listing.md` (add English and Russian under "Localize"), category Tools, icon
   `icons/icon-128.png`, small promo tile `store/promo-440x280.png`, screenshots `store/screenshots/<lang>-*.png`.
3. **Privacy practices:** use the answers below.
4. **Distribution:** public, all regions (or only Moldova and neighbours if you prefer).
5. Submit for review. Host permissions for 11 specific hosts usually mean a review of a few days.

## Privacy practices answers

**Single purpose:**
> Convert a selected amount of money between currencies at the exchange rates published by Moldovan banks and the
> National Bank of Moldova.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `contextMenus` | Adds "Convert “selection” to ▸ currency" to the right-click menu for selected text, the main way to use the extension (the others are the toolbar button and a keyboard shortcut, which need no permission). |
| `activeTab` | After the user picks a menu item or presses the shortcut, reads the selection and shows the conversion result in a small box next to it on the current page. No access to any page otherwise. |
| `scripting` | Injects the result box into the current tab (under activeTab) after a menu click, and reads the rate tables from a bank's page opened in a background tab when that bank's site requires a browser check (maib, Eximbank). |
| `storage` | Saves the user's chosen bank and language, and caches each bank's rates for one hour to avoid repeated requests. |
| `notifications` | Shows the result as a system notification on pages where extensions can't draw (chrome:// pages, the PDF viewer, the Web Store). |
| Host permissions (`www.maib.md`, `micb.md`, `www.victoriabank.md`, `www.otpbank.md`, `procreditbank.md`, `fincombank.com`, `eximbank.md`, `www.energbank.com`, `comertbank.md`, `www.ecb.md`, `www.bnm.md`) | Downloads the public exchange-rate pages or rate APIs of these banks and the National Bank of Moldova. Only the exact host of each bank's public rate page, never the bank's other subdomains; requests carry no cookies (except the bot-check cookie for maib and Eximbank) and so no banking session. No other sites are contacted. |

**Remote code:** No. All code is in the package.

**Data usage:** tick nothing. The extension does not collect or transmit user data. The selected text is parsed
locally and never leaves the browser; the only network requests are GETs for public rate pages, which carry no
user data. Certify the three statements (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://gisterecis.github.io/currency-converter-md/privacy-policy.html

## Updating

Bump `version` in `manifest.json` (the Chrome manifest takes it from there), `npm run build`, upload the new zip on
the item's Package tab.
