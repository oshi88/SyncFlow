import '@shopify/shopify-api/adapters/node';
import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fileUpload from "express-fileupload";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import fs from "fs";
import path from "path";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static("public"));

// Initialize Shopify API (OAuth)
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES.split(","),
  hostName: process.env.HOST.replace(/https?:\/\//, ""),
  apiVersion: ApiVersion.July24,
});

// ---------- STEP 1: OAuth Flow ----------
app.get("/auth", async (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing shop parameter");

  try {
    // This function ALREADY handles redirect
    await shopify.auth.beginAuth(req, res, shop, "/auth/callback", false);
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).send("Authentication failed");
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    const session = await shopify.auth.validateAuthCallback(req, res, req.query);

    console.log("✅ Authenticated shop:", session.shop);

    res.redirect(`/?shop=${session.shop}`);
  } catch (error) {
    console.error("❌ OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});


// ---------- STEP 2: Serve App UI ----------
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// ---------- STEP 3: Export Blogs ----------
app.get("/export-blogs", async (req, res) => {
  try {
    const sessionData = JSON.parse(fs.readFileSync("session.json"));
    const client = new shopify.clients.Rest({ session: sessionData });

    const blogs = await client.get({ path: "blogs" });
    const articlesData = [];

    for (const blog of blogs.body.blogs) {
      const articles = await client.get({ path: `blogs/${blog.id}/articles` });

      articles.body.articles.forEach((a) => {
        articlesData.push({
          Blog_ID: blog.id,
          Blog_Title: blog.title,
          Blog_Handle: blog.handle,
          Article_ID: a.id,
          Article_Title: a.title,
          Article_Author: a.author,
          Article_Handle: a.handle,
          Article_Tags: a.tags,
          Article_Published: a.published_at,
          Article_Body_HTML: a.body_html,
          Article_Image: a.image?.src || "",
        });
      });
    }

    const csv = stringify(articlesData, { header: true });
    const filePath = path.join(process.cwd(), "data", "blogs.csv");
    fs.writeFileSync(filePath, csv);

    res.download(filePath, "blogs.csv");
  } catch (error) {
    console.error("❌ Error exporting blogs:", error);
    res.status(500).send("Error exporting blogs");
  }
});

// ---------- STEP 4: Import Blogs ----------
app.post("/import-blogs", async (req, res) => {
  try {
    const sessionData = JSON.parse(fs.readFileSync("session.json"));
    const client = new shopify.clients.Rest({ session: sessionData });

    if (!req.files || !req.files.file) {
      return res.status(400).send("No file uploaded");
    }

    const fileContent = req.files.file.data.toString();
    const records = parse(fileContent, { columns: true, skip_empty_lines: true });

    // Fetch existing articles to avoid duplicates
    const existingBlogs = await client.get({ path: "blogs" });
    const existingHandles = new Set();

    for (const b of existingBlogs.body.blogs) {
      const articles = await client.get({ path: `blogs/${b.id}/articles` });
      articles.body.articles.forEach((a) => existingHandles.add(a.handle));
    }

    let importedCount = 0;
    for (const row of records) {
      if (existingHandles.has(row.Article_Handle)) {
        console.log(`⏭️ Skipped duplicate: ${row.Article_Handle}`);
        continue;
      }

      const newArticle = {
        article: {
          title: row.Article_Title,
          author: row.Article_Author,
          tags: row.Article_Tags,
          body_html: row.Article_Body_HTML,
          published_at: row.Article_Published,
        },
      };

      const response = await client.post({
        path: `blogs/${row.Blog_ID}/articles`,
        data: newArticle,
        type: "application/json",
      });

      importedCount++;
      console.log(`✅ Imported article: ${response.body.article.title}`);
    }

    res.send(`Successfully imported ${importedCount} articles.`);
  } catch (error) {
    console.error("❌ Error importing blogs:", error);
    res.status(500).send("Error importing blogs");
  }
});

// ---------- STEP 5: Run Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SyncFlow running on port ${PORT}`));
