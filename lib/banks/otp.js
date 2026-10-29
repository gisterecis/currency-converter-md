// OTP Bank: https://www.otpbank.md/exchange, three unlabelled tabs
// (branches, cards, BNM) in a fixed order.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  const rates = (li) => Scrape.table(Scrape.tableRows(li || ""));

  Banks.register({
    id: "otp",
    name: "OTP Bank",
    pageUrl: (lang) => (lang === "ro" ? "https://www.otpbank.md/exchange" : `https://www.otpbank.md/${lang}/exchange`),
    requests: () => [{ url: "https://www.otpbank.md/exchange", marker: "tab__common-title" }],
    parse([html]) {
      const head = Scrape.between(html, "tab__common-title", "</div>");
      const list = Scrape.between(Scrape.between(html, "tab__common-title"), '<ul class="tab__container', "</ul>");
      if (!list) throw Scrape.layoutError("rate tabs not found");
      const [branches, cards] = Scrape.chunks(list, '<li class="tab__item');
      return { date: Scrape.toDate(head), tables: { cash: rates(branches), card: rates(cards) } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
