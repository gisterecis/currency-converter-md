# Store listing text

Each grey box below is one field of the store form. Copy the whole box (on GitHub, use its copy button) and paste
it as is. Paragraphs are deliberately one long line each, so don't re-wrap them: the store keeps every line break
you paste.

- **Chrome Web Store** (Store listing tab): paste **Description** for each language; add English and Russian under
  "Localize", with Romanian as the default. The name and short description come from the package
  (`_locales/*/messages.json`), so they're shown here only for reference.
- **addons.mozilla.org**: paste **Name**, **Summary** and **Description** for each language.
- Category: Tools.
- Images: `../icons/icon-128.png`, `promo-440x280.png` (small promo tile), and `screenshots/<lang>-1.png` to
  `screenshots/<lang>-3.png` (1280×800). Regenerate them with `npm run store:screenshots`.

`npm test` checks that the names and summaries here match the package and that no paragraph got wrapped.

## Română (implicit)

Nume

```text
Convertor valutar MD
```

Descriere scurtă

```text
Selectează o sumă, click dreapta și convertește la cursul băncii tale: maib, MICB, Victoriabank, OTP, BNM și altele.
```

Descriere

```text
Vezi pe loc cât face un preț în lei, euro sau dolari la cursul băncii tale din Moldova.

Selectează o sumă pe orice pagină (de exemplu „1.299,00 €”, „$849.99” sau „24 990 lei”), dă click dreapta și alege „Convertește… în”. Lângă selecție apare o fereastră mică cu:
• cât primești dacă vinzi suma și cât plătești dacă o cumperi;
• cursul pentru numerar la sucursale, pentru operațiuni cu cardul și, unde banca îl publică, cursul online;
• taxa de 0,1% la cumpărarea valutei în numerar, inclusă și marcată;
• care variantă e cea mai bună și cursul efectiv („1 EUR = 19,90 MDL”).

Click pe un rezultat îl copiază. Suma se poate modifica direct în fereastră. Butonul din bara de instrumente deschide convertorul fără să selectezi nimic, iar Alt+Shift+C convertește selecția fără meniu.

Bănci: maib, Moldindconbank, Victoriabank, OTP Bank, ProCredit Bank, FinComBank, Eximbank, Energbank, Comerțbank, EuroCreditBank, plus cursul oficial BNM (40 de valute). Alegi banca în setări sau direct din fereastră.

Recunoaște formatele 1.234,56 · 1,234.56 · 1 234,56 și valutele scrise cu simbol, cod sau cuvânt (€, $, lei, dolari, евро, руб.). Când separatorul e ambiguu (1,234), arată ambele variante.

Interfață în română, engleză și rusă.

Cursurile sunt preluate direct de pe site-urile băncilor, păstrate o oră și au caracter informativ: la tranzacție se aplică cursul băncii din acel moment. Extensia nu este afiliată cu nicio bancă și nu colectează date.
```

## English

Name

```text
Currency Converter MD
```

Short description

```text
Select an amount, right-click and convert it at your Moldovan bank's rates: maib, MICB, Victoriabank, OTP, BNM and more.
```

Description

```text
See what a price comes to in lei, euros or dollars at your Moldovan bank's exchange rate.

Select an amount on any page (say "1.299,00 €", "$849.99" or "24 990 lei"), right-click and choose "Convert… to". A small box next to the selection shows:
• what you get when you sell the amount and what you pay when you buy it;
• the bank's cash, card and, where published, online rates;
• the 0.1% fee on buying foreign cash, included and marked;
• which option is best, and the effective rate ("1 EUR = 19.90 MDL").

Click a result to copy it, or edit the amount right in the box. The toolbar button opens the converter without selecting anything, and Alt+Shift+C converts the selection without the menu.

Banks: maib, Moldindconbank, Victoriabank, OTP Bank, ProCredit Bank, FinComBank, Eximbank, Energbank, Comerțbank, EuroCreditBank, plus the National Bank of Moldova's official rate (40 currencies). Pick your bank in the settings or straight from the box.

Understands 1.234,56 · 1,234.56 · 1 234,56 and currencies written as symbols, codes or words (€, $, lei, dolari, евро, руб.). When the separator is ambiguous (1,234) it shows both readings.

Interface in Romanian, English and Russian.

Rates are read directly from the banks' websites, kept for an hour, and are for information only: the bank's rate at the time of the transaction applies. Not affiliated with any bank. Collects no data.
```

## Русский

Название

```text
Конвертер валют MD
```

Краткое описание

```text
Выделите сумму, нажмите правой кнопкой и конвертируйте по курсу вашего банка: maib, MICB, Victoriabank, OTP, НБМ и др.
```

Описание

```text
Сразу видно, сколько стоит цена в леях, евро или долларах по курсу вашего банка в Молдове.

Выделите сумму на любой странице (например «1.299,00 €», «$849.99» или «24 990 lei»), нажмите правой кнопкой и выберите «Конвертировать… в». Рядом с выделением появится окошко:
• сколько вы получите, продав сумму, и сколько заплатите, купив её;
• курс для наличных в отделениях, для операций по карте и, если банк его публикует, онлайн-курс;
• сбор 0,1% при покупке наличной валюты уже учтён и отмечен;
• какой вариант выгоднее и фактический курс («1 EUR = 19,90 MDL»).

Нажмите на результат, чтобы скопировать его, или измените сумму прямо в окошке. Кнопка на панели открывает конвертер без выделения, а Alt+Shift+C конвертирует выделенное без меню.

Банки: maib, Moldindconbank, Victoriabank, OTP Bank, ProCredit Bank, FinComBank, Eximbank, Energbank, Comerțbank, EuroCreditBank, а также официальный курс НБМ (40 валют). Банк выбирается в настройках или прямо в окошке.

Понимает форматы 1.234,56 · 1,234.56 · 1 234,56 и валюты в виде символа, кода или слова (€, $, lei, dolari, евро, руб.). Если разделитель неоднозначен (1,234), показывает оба варианта.

Интерфейс на румынском, английском и русском.

Курсы берутся напрямую с сайтов банков, хранятся час и носят информационный характер: при операции действует курс банка на тот момент. Расширение не связано ни с одним банком и не собирает данные.
```
