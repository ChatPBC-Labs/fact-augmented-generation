import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  pollSource,
  stableHash,
  normalizeSource,
  WatchSession,
  HeuristicExtractor,
  MemoryFactStore,
  FileFactStore,
} from "factag";

const PAGE_V1 = `<!doctype html><html><head><title>Acme Billing</title><style>.x{}</style></head>
<body><h1>Refunds</h1><p>Every paid plan has a 30 day money back guarantee.</p>
<p>Refunds go back to the original payment method within 5 to 10 business days.</p>
<h1>Support</h1><p>Enterprise customers get 24 by 7 support.</p></body></html>`;

const PAGE_V2 = `<!doctype html><html><head><title>Acme Billing</title><style>.x{}</style></head>
<body><h1>Refunds</h1><p>Every paid plan has a 30 day money back guarantee.</p>
<h1>Support</h1><p>Support hours moved to 8 am to 8 pm Eastern Time for everyone.</p></body></html>`;

const PAGE_V2_IDEM = PAGE_V2;

function startSite(pagesRef) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const page = pagesRef.current;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/billing` }));
  });
}

test("stableHash is deterministic and whitespace-insensitive", () => {
  assert.equal(stableHash("a b  c"), stableHash("a\nb \tc"));
  assert.notEqual(stableHash("v1"), stableHash("v2"));
});

test("normalizeSource classifies url, sitemap, dir", () => {
  assert.deepEqual(normalizeSource("https://x.com"), { type: "url", url: "https://x.com" });
  assert.deepEqual(normalizeSource("https://x.com/sitemap.xml"), { type: "sitemap", url: "https://x.com/sitemap.xml" });
  assert.deepEqual(normalizeSource("./docs"), { type: "dir", path: "./docs" });
});

test("pollSource: first pass adds facts, second identical pass is a no-change hash hit", async () => {
  const pagesRef = { current: PAGE_V1 };
  const site = await startSite(pagesRef);
  try {
    const store = new MemoryFactStore();
    const extractor = new HeuristicExtractor();
    const first = await pollSource({ source: site.url, store, extractor });
    assert.equal(first.changed, true);
    assert.equal(first.kept, 2);
    assert.equal(first.pruned, 0);
    assert.equal(await store.size(), 2);

    const second = await pollSource({ source: site.url, store, extractor, lastHash: first.hash });
    assert.equal(second.changed, false);
    assert.equal(await store.size(), 2);
  } finally {
    site.server.close();
  }
});

test("pollSource: website change detected; changed page adds new fact", async () => {
  const pagesRef = { current: PAGE_V1 };
  const site = await startSite(pagesRef);
  try {
    const store = new MemoryFactStore();
    const extractor = new HeuristicExtractor();
    const first = await pollSource({ source: site.url, store, extractor });
    assert.equal(first.kept, 2);

    pagesRef.current = PAGE_V2_IDEM;
    const second = await pollSource({ source: site.url, store, extractor, lastHash: first.hash });
    assert.equal(second.changed, true);
    assert.equal(second.added, 1);
    const texts = (await store.all()).map((f) => f.text);
    assert.ok(texts.some((t) => t.includes("8 am to 8 pm")), `missing updated fact; got: ${texts.join(" | ")}`);
  } finally {
    site.server.close();
  }
});

test("pollSource pruneStale: fact removed from website gets deleted from store", async () => {
  const pagesRef = { current: PAGE_V1 };
  const site = await startSite(pagesRef);
  try {
    const store = new MemoryFactStore();
    const extractor = new HeuristicExtractor();
    const first = await pollSource({ source: site.url, store, extractor, pruneStale: true });
    assert.equal((await store.size()), 2);
    assert.ok((await store.all()).some((f) => f.text.includes("24 by 7")));

    pagesRef.current = PAGE_V2_IDEM;
    const second = await pollSource({ source: site.url, store, extractor, lastHash: first.hash, pruneStale: true });
    assert.equal(second.changed, true);
    assert.ok(second.removedCandidates.some((f) => f.text.includes("24 by 7")), "stale fact is a candidate");
    assert.equal(second.pruned, 1);
    const texts = (await store.all()).map((f) => f.text);
    assert.ok(!texts.some((t) => t.includes("24 by 7")), "stale fact pruned");
    assert.ok(texts.some((t) => t.includes("8 am to 8 pm")), "new fact present");
  } finally {
    site.server.close();
  }
});

test("WatchSession fires change then nochange, and stop() ends the loop", async () => {
  const pagesRef = { current: PAGE_V1 };
  const site = await startSite(pagesRef);
  try {
    const store = new MemoryFactStore();
    const events = [];
    const session = new WatchSession({
      source: site.url,
      store,
      extractor: new HeuristicExtractor(),
      intervalMs: 5000,
      onEvent: (e) => events.push(e.kind),
    });
    const first = await session.tick();
    assert.equal(first.kind, "change");
    const second = await session.tick();
    assert.equal(second.kind, "nochange");
    assert.deepEqual(events, ["change", "nochange"]);
    session.stop();
    assert.throws(() => session.start(), { message: /already stopped/i });
  } finally {
    site.server.close();
  }
});

test("pollSource with FileFactStore prune persists removal", async () => {
  const pagesRef = { current: PAGE_V1 };
  const site = await startSite(pagesRef);
  const path = `live-test-${Date.now()}-watch.jsonl`;
  try {
    const store = new FileFactStore(path);
    const extractor = new HeuristicExtractor();
    const first = await pollSource({ source: site.url, store, extractor, pruneStale: true });
    assert.equal(await store.size(), 2);
    pagesRef.current = PAGE_V2_IDEM;
    await pollSource({ source: site.url, store, extractor, lastHash: first.hash, pruneStale: true });
    const reloaded = new FileFactStore(path);
    assert.ok(!(await reloaded.all()).some((f) => f.text.includes("24 by 7")));
  } finally {
    site.server.close();
  }
});
