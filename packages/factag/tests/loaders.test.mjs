import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToText, extractTitle, TextLoader, URLLoader, urlsFromSitemapXml, looksLikeHtml } from "../dist/index.js";

test("htmlToText strips chrome and renders headings", () => {
  const html = `
    <html><head><title>My Page</title><script>var x = 1;</script><style>.a{}</style></head>
    <body><nav>Home Pricing Contact</nav>
    <h1>Pricing</h1><p>The Pro plan costs <strong>$49</strong> per month.</p>
    <ul><li>Unlimited projects</li><li>Email support</li></ul>
    <footer>Copyright footer</footer></body></html>`;
  const text = htmlToText(html);
  assert.ok(!text.includes("var x"));
  assert.ok(!text.includes("Home Pricing Contact"), "nav chrome should be removed");
  assert.ok(!text.includes("Copyright footer"), "footer chrome should be removed");
  assert.ok(text.includes("# Pricing"));
  assert.ok(text.includes("$49"));
  assert.ok(text.includes("- Unlimited projects"));
  assert.equal(extractTitle(html), "My Page");
});

test("htmlToText decodes entities", () => {
  const text = htmlToText("<p>Tom &amp; Jerry &lt;3 &nbsp; caf&#233;</p>");
  assert.ok(text.includes("Tom & Jerry"));
  assert.ok(text.includes("café"));
});

test("looksLikeHtml classifies content", () => {
  assert.ok(looksLikeHtml("text/html; charset=utf-8", "anything"));
  assert.ok(looksLikeHtml(null, "<!DOCTYPE html><html>"));
  assert.ok(!looksLikeHtml("text/markdown", "# heading"));
});

test("TextLoader auto-detects html vs text", async () => {
  const htmlDocs = await new TextLoader("<h1>Hi</h1><p>Body text.</p>").load();
  assert.ok(htmlDocs[0].pageContent.includes("# Hi"));
  const mdDocs = await new TextLoader("# Just markdown\ncontent").load();
  assert.ok(mdDocs[0].pageContent.startsWith("# Just markdown"));
});

test("URLLoader uses stubbed fetch and attaches metadata", async () => {
  const fetchFn = async (url) =>
    new Response("<html><head><title>T</title></head><body><h1>Docs</h1><p>The API key rotates every 30 days.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  const docs = await new URLLoader("https://docs.example/x", { fetchFn }).load();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].metadata.url, "https://docs.example/x");
  assert.equal(docs[0].metadata.title, "T");
  assert.ok(docs[0].pageContent.includes("# Docs"));
});

test("URLLoader throws on HTTP errors", async () => {
  const fetchFn = async () => new Response("nope", { status: 404 });
  await assert.rejects(() => new URLLoader("https://x.example/404", { fetchFn }).load(), /HTTP 404/);
});

test("urlsFromSitemapXml parses loc entries", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://a.example/1</loc></url><url><loc>https://a.example/2</loc></url></urlset>`;
  assert.deepEqual(urlsFromSitemapXml(xml), ["https://a.example/1", "https://a.example/2"]);
});
