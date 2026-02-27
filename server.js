const express = require('express');
const path = require('path');
const { scrape, scrapeILoveEmas, scrapeGoEmas, scrapeEmasNow } = require('./scraper');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/prices', async (req, res) => {
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
  res.json({ rajaEmas, iloveemas, goEmas, emasNow });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
