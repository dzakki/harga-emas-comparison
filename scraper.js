const { chromium } = require('playwright');
const { execFile } = require('child_process');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Bare curl with no extra headers — the site blocks requests that set browser-like headers.
// Default curl UA + minimal headers is what passes through its WAF.
function curlGet(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', [
      '--silent',
      '--compressed',
      '--location',
      '--max-time', '30',
      url,
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      if (!stdout) return reject(new Error('Empty response from curl'));
      resolve(stdout);
    });
  });
}

async function scrape() {
  const browser = await chromium.launch({
    args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  try {
    await page.goto('https://rajaemasindonesia.co.id/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });


    await page.waitForSelector('table', { timeout: 10000 });

    const data = await page.evaluate(() => {
      function parsePrice(text) {
        const num = text.replace(/[^0-9]/g, '');
        return num ? parseInt(num) : null;
      }

      const tables = document.querySelectorAll('table');

      // Table 1: Jewelry by kadar — 2 columns: Kadar Karat | Harga per Gram
      const jewelry = [];
      if (tables[0]) {
        for (const row of tables[0].querySelectorAll('tbody tr')) {
          const cells = [...row.querySelectorAll('td')];
          if (cells.length < 2) continue;
          const kadar = cells[0].textContent.trim();
          const buy = parsePrice(cells[1].textContent);
          if (kadar && buy) jewelry.push({ kadar, buy, sell: null });
        }
      }

      // Table 2: Logam Mulia — 4 columns: Jenis | Kadar % | Harga per Gram | Karat
      const logamMulia = [];
      if (tables[1]) {
        for (const row of tables[1].querySelectorAll('tbody tr')) {
          const cells = [...row.querySelectorAll('td')];
          if (cells.length < 3) continue;
          const type = cells[0].textContent.trim();
          const buy = parsePrice(cells[2].textContent); // price is index 2
          if (type && buy) logamMulia.push({ type, buy, sell: null });
        }
      }

      return { jewelry, logamMulia };
    });

    return data;
  } finally {
    await browser.close();
  }
}

// iloveemas.co.id is server-rendered — use plain HTTP fetch to avoid bot detection.
// All tab content is in the HTML regardless of which tab is active.
// Buy prices: id="perhiasan-emas"  → td.text-start (kadar), td.text-end (price)
// Sell prices: id="material-emas" → td.text-start (kadar), td.text-end (price)
async function scrapeILoveEmas() {
  const html = await curlGet('https://iloveemas.co.id/harga/');

  function parsePrice(text) {
    const num = (text || '').replace(/<[^>]+>/g, '').replace(/[^0-9]/g, '');
    return num ? parseInt(num) : null;
  }

  function normalize(str) {
    return str.replace(/[\s\-]/g, '').toLowerCase();
  }

  // Extract rows from a section identified by its id attribute.
  // Looks for td.text-start (kadar) and td.text-end (price) within each <tr>.
  function extractSection(sectionId) {
    const marker = `id="${sectionId}"`;
    const start = html.indexOf(marker);
    if (start === -1) return [];

    // End at the next id= attribute to avoid bleeding into the adjacent section
    const afterMarker = start + marker.length;
    const nextId = html.indexOf(' id="', afterMarker);
    const end = nextId !== -1 ? nextId : afterMarker + 15000;

    const chunk = html.slice(start, end);
    const rows = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;

    while ((m = trRegex.exec(chunk)) !== null) {
      const row = m[1];
      if (row.includes('"head"')) continue; // skip header rows

      const kadarM = row.match(/class="[^"]*text-start[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      const priceM = row.match(/class="[^"]*text-end[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      if (!kadarM || !priceM) continue;

      const kadar = kadarM[1].replace(/<[^>]+>/g, '').trim();
      const price = parsePrice(priceM[1]);
      if (kadar && price) rows.push({ kadar, price });
    }
    return rows;
  }

  // Perhiasan: buy from perhiasan-emas, sell from material-emas
  const perhiasanBuyRows = extractSection('perhiasan-emas');
  const perhiasanSellRows = extractSection('material-emas');

  const sellMap = {};
  for (const r of perhiasanSellRows) {
    sellMap[normalize(r.kadar)] = r.price;
  }

  const perhiasan = perhiasanBuyRows.map(r => ({
    kadar: r.kadar,
    buy: r.price,
    sell: sellMap[normalize(r.kadar)] || null,
  }));

  // Logam Mulia: buy from batangan section
  // Sell side (material-antam) is per-weight, not per-gram — skip for now
  const lmRows = extractSection('batangan');
  const logamMulia = lmRows.map(r => ({
    product: r.kadar, // extractSection returns 'kadar' field; here it's the product name
    buy: r.price,
    sell: null,
  }));

  return { perhiasan, logamMulia };
}

// goemas.id embeds all price data as inline JS variables — no browser needed.
// rates.sell_rate = base gold price (what they pay you, per gram K24)
// unitList = array of gold types with murni (purity factor, per mille)
// Per-item price = sell_rate * murni / 1000
async function scrapeGoEmas() {
  const html = await curlGet('https://goemas.id/');

  const ratesM = html.match(/let rates = ({[^;]+})/);
  if (!ratesM) throw new Error('rates not found in goemas.id HTML');
  const rates = JSON.parse(ratesM[1]);

  const unitListM = html.match(/let unitList = (\[[^\n]+\])/);
  if (!unitListM) throw new Error('unitList not found in goemas.id HTML');
  const unitList = JSON.parse(unitListM[1]);

  const sellRate = parseFloat(rates.sell_rate);

  // Perhiasan: standard kadar entries ("Jenis Emas Segala Kondisi")
  const perhiasan = unitList
    .filter(u => u.name.includes('Jenis Emas Segala Kondisi'))
    .map(u => ({
      kadar: u.quality + 'K',
      buy: null,
      sell: Math.round(sellRate * u.murni / 1000),
    }));

  // Logam Mulia: all "LM :" entries
  const logamMulia = unitList
    .filter(u => u.name.includes('LM :'))
    .map(u => ({
      product: u.name.replace(/^24 K - LM : /, '').trim(),
      buy: null,
      sell: Math.round(sellRate * u.murni / 1000),
    }));

  return { perhiasan, logamMulia };
}

// emasnow.id publishes prices as a JSON file — no HTML scraping needed.
// perhiasan: insta_cash margin * karat/24 (the buy price tier shown on site)
// logamMulia: maxi_gold margin applied to K24 (lm_maxi key is absent from JSON)
async function scrapeEmasNow() {
  const json = await curlGet('https://emasnow.id/wp-content/uploads/harga-emas.json');
  const data = JSON.parse(json);
  const base = data.price_per_gram_idr;

  function applyMargin(b, margin) {
    const rup = Number(margin.rupiah) || 0;
    const pct = Number(margin.percent) || 0;
    if (margin.mode === 'percent-first') return (b + b * pct / 100) + rup;
    return (b + rup) * (1 + pct / 100);
  }

  // Perhiasan: common kadar — buy price using insta_cash tier
  const perGramK24 = applyMargin(base, data.perhiasan.insta_cash);
  const perhiasan = [24, 22, 18, 9].map(k => ({
    kadar: k + 'K',
    buy: Math.round(perGramK24 * k / 24),
    sell: null,
  }));

  // Logam Mulia: single K24 buy price using maxi_gold margin
  const logamMulia = [{
    product: 'Logam Mulia K24',
    buy: Math.round(applyMargin(base, data.perhiasan.maxi_gold)),
    sell: null,
  }];

  return { perhiasan, logamMulia };
}

module.exports = { scrape, scrapeILoveEmas, scrapeGoEmas, scrapeEmasNow };
