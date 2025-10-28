const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const csvParser = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());

const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.ACCESS_TOKEN;
const upload = multer({ dest: 'uploads/' });

// ========== Simple Logger ==========
const logToFile = (message) => {
  const timestamp = new Date().toISOString();
  fs.appendFileSync('logs.txt', `[${timestamp}] ${message}\n`);
};

// ================== EXPORT BLOGS ==================
app.get('/export-blogs', async (req, res) => {
  try {
    const response = await axios.get(
      `https://${SHOP}/admin/api/2024-10/articles.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': TOKEN } }
    );

    const articles = response.data.articles;
    if (!articles || articles.length === 0) return res.status(404).send('No articles found');

    const filePath = path.join(__dirname, 'blogs.csv');
    const csvWriter = createCsvWriter({
      path: filePath,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'title', title: 'Title' },
        { id: 'author', title: 'Author' },
        { id: 'blog_id', title: 'Blog ID' },
        { id: 'tags', title: 'Tags' },
        { id: 'body_html', title: 'Content' },
        { id: 'published_at', title: 'Published At' },
        { id: 'image_src', title: 'Image URL' },
      ],
    });

    await csvWriter.writeRecords(
      articles.map(a => ({
        id: a.id,
        title: a.title,
        author: a.author,
        blog_id: a.blog_id,
        tags: a.tags,
        body_html: a.body_html,
        published_at: a.published_at,
        image_src: a.image?.src || '',
      }))
    );

    res.download(filePath, 'blogs.csv', () => fs.unlinkSync(filePath));
  } catch (error) {
    const msg = `Export error: ${error.response?.data?.errors || error.message}`;
    console.error(msg);
    logToFile(msg);
    res.status(500).send('Error exporting blogs. Check logs.txt for details.');
  }
});

// ================== IMPORT BLOGS ==================
app.post('/import-blogs', upload.single('file'), async (req, res) => {
  const results = [];
  if (!req.file) return res.status(400).send('No file uploaded.');

  fs.createReadStream(req.file.path)
    .pipe(csvParser())
    .on('data', row => results.push(row))
    .on('end', async () => {
      try {
        const existingResp = await axios.get(
          `https://${SHOP}/admin/api/2024-10/articles.json?limit=250`,
          { headers: { 'X-Shopify-Access-Token': TOKEN } }
        );
        const existingTitles = new Set(
          existingResp.data.articles.map(a => a.title.toLowerCase())
        );

        let skipped = 0;
        let imported = 0;

        for (const article of results) {
          if (existingTitles.has(article.Title.toLowerCase())) {
            skipped++;
            continue;
          }

          try {
            await axios.post(
              `https://${SHOP}/admin/api/2024-10/articles.json`,
              {
                article: {
                  title: article.Title,
                  author: article.Author,
                  tags: article.Tags,
                  body_html: article.Content,
                  published: true,
                  blog_id: article.BlogID || undefined,
                  image: article['Image URL'] ? { src: article['Image URL'] } : undefined,
                },
              },
              { headers: { 'X-Shopify-Access-Token': TOKEN } }
            );
            imported++;
          } catch (err) {
            logToFile(`Failed importing "${article.Title}": ${err.response?.data?.errors || err.message}`);
          }
        }

        fs.unlinkSync(req.file.path);
        const summary = `Import complete — Imported: ${imported}, Skipped: ${skipped}`;
        logToFile(summary);
        res.send(summary);
      } catch (error) {
        const msg = `Import error: ${error.response?.data?.errors || error.message}`;
        console.error(msg);
        logToFile(msg);
        res.status(500).send('Error importing blogs. Check logs.txt for details.');
      }
    });
});

// ================== DASHBOARD ==================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`🚀 SyncFlow running at http://localhost:${PORT}`);
  logToFile('Server started successfully.');
});
