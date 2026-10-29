// Victoriabank: JSON API behind the site's /curs-valutar page.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  const API = "https://www.victoriabank.md/bff/api/currency-rates";
  // marketType: 11 = numerar (branches), 14 = online (VB24).
  const MARKETS = [
    ["cash", 11],
    ["online", 14],
  ];

  // dateTo may not be later than the server's today, so use UTC dates.
  const utcDay = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  // Several rate sets are published per day; the current one is the latest
  // whose fromDate (Chișinău local time) has passed.
  function current(json, now) {
    const groups = ((json && json.rates) || []).filter((g) => g.fromDate && g.fromDate.slice(0, 16) <= now);
    groups.sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
    return groups[groups.length - 1] || null;
  }

  Banks.register({
    id: "victoriabank",
    name: "Victoriabank",
    pageUrl: (lang) => (lang === "ro" ? "https://www.victoriabank.md/curs-valutar" : `https://www.victoriabank.md/${lang}/curs-valutar`),
    requests: () =>
      MARKETS.map(([, type]) => ({ url: `${API}?dateFrom=${utcDay(-1)}&dateTo=${utcDay(0)}&marketType=${type}`, type: "json" })),
    noteKey: "noteVictoriabank",
    parse(bodies, { now = Scrape.chisinau() } = {}) {
      const nowStamp = `${now.iso}T${now.time}`;
      const tables = {};
      let latest = null;
      MARKETS.forEach(([key], i) => {
        const g = current(bodies[i], nowStamp);
        if (!g) return;
        tables[key] = Scrape.table(
          (g.currencies || []).map((c) => {
            const r = (c.currencyRates || [])[0] || {};
            return [c.currency, r.buyRate, r.sellRate];
          })
        );
        if (key === "cash" || !latest) latest = g.fromDate;
      });
      if (!tables.cash && !tables.online) throw Scrape.layoutError("no rate groups");
      return { date: Scrape.toDate(latest), time: latest ? latest.slice(11, 16) : null, tables };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
