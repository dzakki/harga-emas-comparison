const fs = require('fs');
const path = require('path');
const { scrape, scrapeILoveEmas, scrapeGoEmas, scrapeEmasNow } = require('./scraper');

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rupiah(num) {
  if (num == null) return '<span class="na">-</span>';
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}

function perhiasanRows(rows, kadarKey = 'kadar') {
  if (!rows || rows.length === 0) return '<tr><td colspan="3" class="na">Tidak ada data.</td></tr>';
  return rows.map(row => `
          <tr>
            <td>${esc(row[kadarKey])}</td>
            <td class="price">${rupiah(row.buy)}</td>
            <td class="price">${rupiah(row.sell)}</td>
          </tr>`).join('');
}

function logamMuliaRows(rows) {
  if (!rows || rows.length === 0) return '<tr><td colspan="3" class="na">Tidak ada data.</td></tr>';
  return rows.map(row => `
          <tr>
            <td>${esc(row.type || row.product)}</td>
            <td class="price">${rupiah(row.buy)}</td>
            <td class="price">${rupiah(row.sell)}</td>
          </tr>`).join('');
}

function errRows(msg) {
  return `<tr><td colspan="3" style="color:#c0392b;">Gagal: ${esc(msg)}</td></tr>`;
}

function section(title, tbodyHtml, colHeaders = ['Kadar', 'Harga Beli', 'Harga Jual']) {
  return `
    <div class="section">
      <h2>${esc(title)}</h2>
      <table>
        <thead>
          <tr>${colHeaders.map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>${tbodyHtml}
        </tbody>
      </table>
    </div>`;
}

function generateHtml(data, updatedAt) {
  const { rajaEmas, iloveemas, goEmas, emasNow } = data;

  const rajaJewelry = rajaEmas.error ? errRows(rajaEmas.error) : perhiasanRows(rajaEmas.jewelry);
  const rajaLm      = rajaEmas.error ? errRows(rajaEmas.error) : logamMuliaRows(rajaEmas.logamMulia);

  const iloveJewelry = iloveemas.error ? errRows(iloveemas.error) : perhiasanRows(iloveemas.perhiasan);
  const iloveLm      = iloveemas.error ? errRows(iloveemas.error) : logamMuliaRows(iloveemas.logamMulia);

  const goJewelry = goEmas.error ? errRows(goEmas.error) : perhiasanRows(goEmas.perhiasan);
  const goLm      = goEmas.error ? errRows(goEmas.error) : logamMuliaRows(goEmas.logamMulia);

  const nowJewelry = emasNow.error ? errRows(emasNow.error) : perhiasanRows(emasNow.perhiasan);
  const nowLm      = emasNow.error ? errRows(emasNow.error) : logamMuliaRows(emasNow.logamMulia);

  const lmCols = ['Produk', 'Harga Beli', 'Harga Jual'];

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Harga Emas</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: sans-serif;
      background: #f4f4f4;
      color: #222;
      padding: 32px 16px;
    }

    .container {
      max-width: 720px;
      margin: 0 auto;
    }

    h1 {
      font-size: 1.3rem;
      margin-bottom: 4px;
    }

    .subtitle {
      font-size: 0.85rem;
      color: #888;
      margin-bottom: 28px;
    }

    .section {
      margin-bottom: 32px;
    }

    .section h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 10px;
      color: #333;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    thead tr {
      background: #421a40;
      color: #fff;
    }

    th, td {
      padding: 10px 14px;
      text-align: left;
      font-size: 0.9rem;
    }

    tbody tr {
      border-bottom: 1px solid #f0f0f0;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody tr:hover {
      background: #fafafa;
    }

    .price {
      font-variant-numeric: tabular-nums;
    }

    .na {
      color: #bbb;
    }

    #last-updated {
      font-size: 0.8rem;
      color: #aaa;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="container">

    <h1>Harga Emas</h1>
    <p class="subtitle">Harga beli emas per gram (harga emas yang dibeli oleh toko)</p>

    ${section('Raja Emas Indonesia — Harga Perhiasan Emas', rajaJewelry)}
    ${section('Raja Emas Indonesia — Logam Mulia', rajaLm, lmCols)}
    ${section('I Love Emas — Harga Perhiasan Emas', iloveJewelry)}
    ${section('I Love Emas — Logam Mulia', iloveLm, lmCols)}
    ${section('Go Emas — Harga Perhiasan Emas', goJewelry)}
    ${section('Go Emas — Logam Mulia', goLm, lmCols)}
    ${section('Emas Now — Harga Perhiasan Emas', nowJewelry)}
    ${section('Emas Now — Logam Mulia', nowLm, lmCols)}

    <div id="last-updated">Diperbarui: ${updatedAt} WITA</div>

  </div>
</body>
</html>`;
}

async function main() {
  console.log('Scraping all sources...');

  const [rajaEmas, iloveemas, goEmas, emasNow] = await Promise.all([
    scrape()
      .then(r => ({ ...r, error: null }))
      .catch(err => ({ jewelry: [], logamMulia: [], error: err.message })),
    scrapeILoveEmas()
      .then(r => ({ ...r, error: null }))
      .catch(err => ({ perhiasan: [], logamMulia: [], error: err.message })),
    scrapeGoEmas()
      .then(r => ({ ...r, error: null }))
      .catch(err => ({ perhiasan: [], logamMulia: [], error: err.message })),
    scrapeEmasNow()
      .then(r => ({ ...r, error: null }))
      .catch(err => ({ perhiasan: [], logamMulia: [], error: err.message })),
  ]);

  const failed = [rajaEmas, iloveemas, goEmas, emasNow].filter(s => s.error);
  if (failed.length) {
    failed.forEach(s => console.warn('Scrape error:', s.error));
  }
  console.log(`${4 - failed.length}/4 sources succeeded.`);

  const updatedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' });
  const html = generateHtml({ rajaEmas, iloveemas, goEmas, emasNow }, updatedAt);

  const outDir = path.join(__dirname, 'docs');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

  console.log('Generated docs/index.html — updated:', updatedAt);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
