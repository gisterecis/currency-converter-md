// Turns a text selection like "1.234,56 €", "$1,250" or "1 250,50 lei" into
// an amount (or two, when the separators are ambiguous) and a currency code.
(function (root) {
  "use strict";

  const MAX_SELECTION_LENGTH = 80;

  // Currency tokens (English, Romanian, Russian). `word: true` tokens must not
  // touch other letters, so "lei" matches in "100 lei" but not in "bleile".
  const TOKENS = [
    { code: "EUR", src: "€", word: false },
    { code: "EUR", src: "eur|euros?|евро", word: true },
    { code: "USD", src: "\\$", word: false },
    { code: "USD", src: "usd|dollars?|dolar(?:i|ul|ului|ilor)?|долл(?:ар(?:ов|а|ы)?)?\\.?|дол\\.?", word: true },
    { code: "GBP", src: "£", word: false },
    { code: "GBP", src: "gbp|pounds?|lir[ăae]\\s+sterlin[ăe]|sterline|фунт(?:ов|а|ы)?(?:\\s+стерлингов)?", word: true },
    { code: "RON", src: "ron", word: true },
    { code: "MDL", src: "mdl|lei|leu|лей|леев|лея", word: true },
    { code: "UAH", src: "₴", word: false },
    { code: "UAH", src: "uah|грн\\.?|гривн[аы]?|гривен|hryvnias?|grivn[ăe]|hrivn[ăe]", word: true },
    { code: "CHF", src: "chf|sfr\\.?|fr\\.|franc(?:i|ul)?\\s+elve[țţ]ien(?:i|esc)?|франк(?:ов|а|и)?", word: true },
    { code: "RUB", src: "₽", word: false },
    { code: "RUB", src: "rub|руб(?:\\.|лей|ля|ль)?|rubl[ăe]|ruble", word: true },
    { code: "PLN", src: "zł|pln|zlo[țţt]i|злот(?:ый|ых|ого)", word: true },
    { code: "TRY", src: "₺", word: false },
  ];

  // Other currencies the BNM quotes, recognised by their code. Upper case
  // only: "try", "all" and "cad" are also words.
  const CODES = "AED ALL AMD AUD AZN BYN CAD CNY CZK DKK GEL HKD HUF ILS INR ISK JPY KGS KRW KWD KZT MKD MYR NOK NZD RSD SEK TJS TMT TRY UZS";

  const WS = "[\\s\\u00A0\\u202F\\u2009]*";
  const L_BEFORE = "(?<!\\p{L})";
  const L_AFTER = "(?!\\p{L})";

  function matcher(code, src, word, flags) {
    return {
      code,
      after: new RegExp("^" + WS + "(?:" + src + ")" + (word ? L_AFTER : ""), flags),
      before: new RegExp((word ? L_BEFORE : "") + "(?:" + src + ")" + WS + "$", flags),
      anywhere: new RegExp((word ? L_BEFORE : "") + "(?:" + src + ")" + (word ? L_AFTER : ""), flags),
    };
  }

  const MATCHERS = [
    ...TOKENS.map((t) => matcher(t.code, t.src, t.word, "iu")),
    ...CODES.split(" ").map((c) => matcher(c, c, true, "u")),
  ];

  // A run that starts and ends with a digit and may contain separators.
  const RUN_RE = /\d(?:[\d.,'’\s   ]*\d)?/u;
  const SPACE_SEPS = new Set([" ", " ", " ", " ", "'", "’"]);

  function detectCurrency(text, start, end) {
    const after = text.slice(end);
    const before = text.slice(0, start);
    for (const m of MATCHERS) if (m.after.test(after)) return m.code;
    for (const m of MATCHERS) if (m.before.test(before)) return m.code;
    // Not adjacent: accept a currency mentioned elsewhere only if it's the only one.
    const found = new Set();
    for (const m of MATCHERS) if (m.anywhere.test(before + " " + after)) found.add(m.code);
    return found.size === 1 ? [...found][0] : null;
  }

  // Split "1.234,56" into groups ["1","234","56"] and seps [".", ","].
  // Returns null if a separator is longer than one character.
  function tokenize(run) {
    const groups = [];
    const seps = [];
    const re = /(\d+)|([^\d]+)/g;
    let m;
    while ((m = re.exec(run))) {
      if (m[1]) groups.push(m[1]);
      else {
        if (m[2].length !== 1) return { groups, seps, cutAt: groups.length };
        seps.push(m[2]);
      }
    }
    return { groups, seps, cutAt: null };
  }

  const toNum = (intDigits, fracDigits) => Number(intDigits + (fracDigits ? "." + fracDigits : ""));

  function validThousands(groups) {
    if (groups[0].length < 1 || groups[0].length > 3) return false;
    return groups.slice(1).every((g) => g.length === 3);
  }

  // Interpret groups/seps. Returns an array of candidate values, or null if
  // the grouping is invalid (the caller then retries with fewer groups).
  function interpret(groups, seps) {
    if (seps.length === 0) return [Number(groups[0])];

    const punct = seps.filter((s) => s === "." || s === ",");
    const kinds = new Set(punct);
    const last = seps[seps.length - 1];
    const lastIsPunct = last === "." || last === ",";

    if (kinds.size === 2) {
      // The last separator is the decimal point; it must occur once.
      if (!lastIsPunct || punct.filter((s) => s === last).length !== 1) return null;
      const intGroups = groups.slice(0, -1);
      if (!validThousands(intGroups)) return null;
      return [toNum(intGroups.join(""), groups[groups.length - 1])];
    }

    if (kinds.size === 1) {
      const count = punct.length;
      if (count > 1) {
        // Repeated "." or "," is a thousands separator: "1.234.567".
        if (!validThousands(groups)) return null;
        return [Number(groups.join(""))];
      }
      // Exactly one "." or ",".
      if (!lastIsPunct) {
        // "1,234 567" – the punctuation is grouping too.
        if (!validThousands(groups)) return null;
        return [Number(groups.join(""))];
      }
      const intGroups = groups.slice(0, -1);
      const frac = groups[groups.length - 1];
      if (intGroups.length > 1) {
        // Spaces before it ("1 234,56"), so it's the decimal point.
        if (!validThousands(intGroups)) return null;
        return [toNum(intGroups.join(""), frac)];
      }
      const int = intGroups[0];
      const ambiguous = frac.length === 3 && int.length <= 3 && !/^0+$/.test(int);
      if (ambiguous) {
        // Thousands reading first: 3-decimal prices are rare.
        return [Number(int + frac), toNum(int, frac)];
      }
      return [toNum(int, frac)];
    }

    // Only space-like separators: "1 234 567" or "1'234".
    if (!validThousands(groups)) return null;
    return [Number(groups.join(""))];
  }

  function parseSelection(input) {
    if (typeof input !== "string") return null;
    const text = input.replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_SELECTION_LENGTH) return null;

    const m = RUN_RE.exec(text);
    if (!m) return null;

    let { groups, seps, cutAt } = tokenize(m[0]);
    if (cutAt !== null) {
      groups = groups.slice(0, cutAt);
      seps = seps.slice(0, Math.max(0, cutAt - 1));
    }

    // Retry with fewer groups until the grouping makes sense
    // ("2024 100" -> "2024").
    let values = null;
    let used = groups.length;
    for (; used >= 1; used--) {
      values = interpret(groups.slice(0, used), seps.slice(0, used - 1));
      if (values) break;
    }
    if (!values || values.some((v) => !Number.isFinite(v))) return null;

    // Rebuild the matched number text from what was actually used.
    let numText = groups[0];
    for (let i = 1; i < used; i++) numText += seps[i - 1] + groups[i];
    const start = m.index;
    let end = start + numText.length;

    let negative = false;
    const prev = text[start - 1];
    const prevPrev = text[start - 2];
    let signStart = start;
    if ((prev === "-" || prev === "−") && (prevPrev === undefined || !/[\p{L}\d]/u.test(prevPrev))) {
      negative = true;
      signStart = start - 1;
    }

    const currency = detectCurrency(text, signStart, end);
    const sign = negative ? -1 : 1;

    return {
      text: (negative ? "-" : "") + numText,
      currency,
      ambiguous: values.length > 1,
      candidates: values.map((v) => sign * v),
    };
  }

  const api = { parseSelection, MAX_SELECTION_LENGTH };
  root.CurrencyParse = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
