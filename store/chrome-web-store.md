# Publishing on the Chrome Web Store

The package is `release/<version>/convertor-valutar-md-chrome-<version>.zip` (`scripts/package.sh`, which also
tests, lints and checks it; `npm run build:chrome` alone puts it in `web-ext-artifacts/`). Run
`scripts/package.sh --e2e` before each upload.

## One-time setup (you)

1. Register a developer account at https://chrome.google.com/webstore/devconsole (one-time US$5 fee) and verify
   the contact email.
2. Host `privacy-policy.html` (contact: gisterecis@moldchem.com) at a public URL, for example GitHub Pages. The dashboard needs a direct link to the policy
   page itself.

## New item

1. **Package:** upload the zip.
2. **Store listing:** text from `listing.md` (add English and Russian under "Localize"), category Tools, icon
   `icons/icon-128.png`, small promo tile `store/promo-440x280.png`, screenshots `store/screenshots/<lang>-*.png`.
3. **Privacy practices:** use the answers below.
4. **Distribution:** public, all regions (or only Moldova and neighbours if you prefer).
5. Submit for review. Host permissions for 11 specific sites usually mean a review of a few days.

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
| Host permissions (`*.maib.md`, `*.micb.md`, `*.victoriabank.md`, `*.otpbank.md`, `*.procreditbank.md`, `*.fincombank.com`, `*.eximbank.md`, `*.energbank.com`, `*.comertbank.md`, `*.ecb.md`, `*.bnm.md`) | Downloads the public exchange-rate pages or rate APIs of these banks and the National Bank of Moldova. No other sites are contacted. |

**Remote code:** No. All code is in the package.

**Data usage:** tick nothing. The extension does not collect or transmit user data. The selected text is parsed
locally and never leaves the browser; the only network requests are GETs for public rate pages, which carry no
user data. Certify the three statements (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** the hosted `privacy-policy.html`.

## Updating

Bump `version` in `manifest.json` (the Chrome manifest takes it from there), `npm run build`, upload the new zip on
the item's Package tab.
