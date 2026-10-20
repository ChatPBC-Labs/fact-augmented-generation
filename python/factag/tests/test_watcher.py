import asyncio
import http.server
import pathlib
import threading
from tempfile import TemporaryDirectory

import unittest

from factag import (
    HeuristicExtractor,
    MemoryFactStore,
    FileFactStore,
    WatchSession,
    normalize_source,
    poll_source,
    stable_hash,
)


class _Site(http.server.BaseHTTPRequestHandler):
    current = "v1"
    body_v1 = (
        "<html><head><title>A</title></head><body>"
        "<h1>Refunds</h1>"
        "<p>Every paid plan has a 30 day money back guarantee.</p>"
        "<p>Refunds go back to the original payment method within 5 to 10 business days.</p>"
        "<h1>Support</h1>"
        "<p>Enterprise customers get 24 by 7 support.</p>"
        "</body></html>"
    ).encode()
    body_v2 = (
        "<html><head><title>A</title></head><body>"
        "<h1>Refunds</h1>"
        "<p>Every paid plan has a 30 day money back guarantee.</p>"
        "<h1>Support</h1>"
        "<p>Support hours moved to 8 am to 8 pm Eastern Time for everyone.</p>"
        "</body></html>"
    ).encode()

    def do_GET(self):
        body = self.body_v2 if self.current == "v2" else self.body_v1
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence
        pass


class TestWatcher(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server = http.server.HTTPServer(("127.0.0.1", 0), _Site)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/billing"
        self.extractor = HeuristicExtractor()

    async def asyncTearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    async def test_helpers(self):
        self.assertEqual(stable_hash("a b  c"), stable_hash("a\nb\tc"))
        self.assertEqual(normalize_source("https://x.com/a/sitemap.xml"), ("sitemap", "https://x.com/a/sitemap.xml"))
        self.assertEqual(normalize_source("https://x.com/f"), ("url", "https://x.com/f"))
        self.assertEqual(normalize_source("./docs"), ("dir", "./docs"))

    async def test_first_pass_then_hash_hit(self):
        store = MemoryFactStore()
        first = await poll_source(self.url, store, extractor=self.extractor)
        self.assertTrue(first.changed)
        self.assertEqual(len(store), 3)  # Python heuristic keeps all 3 sentences (TS keeps 2 — documented divergence)
        second = await poll_source(self.url, store, extractor=self.extractor, last_hash=first.hash)
        self.assertFalse(second.changed)
        self.assertEqual(len(store), 3)

    async def test_change_adds_new_fact(self):
        store = MemoryFactStore()
        first = await poll_source(self.url, store, extractor=self.extractor)
        _Site.current = "v2"
        try:
            second = await poll_source(self.url, store, extractor=self.extractor, last_hash=first.hash)
            self.assertTrue(second.changed)
            self.assertEqual(second.added, 1)
            texts = [f.text for f in store.all()]
            self.assertTrue(any("8 am to 8 pm" in t for t in texts))
        finally:
            _Site.current = "v1"

    async def test_prune_removes_stale_fact(self):
        _Site.current = "v1"
        store = MemoryFactStore()
        await poll_source(self.url, store, extractor=self.extractor, prune_stale=True)
        self.assertTrue(any("24 by 7" in f.text for f in store.all()))
        _Site.current = "v2"
        try:
            second = await poll_source(self.url, store, extractor=self.extractor, prune_stale=True)
            self.assertTrue(any("24 by 7" in f.text for f in second.removed_candidates))
            self.assertEqual(second.pruned, 2)  # "Refunds go back..." AND "24 by 7" are both absent from v2
            self.assertFalse(any("24 by 7" in f.text for f in store.all()))
        finally:
            _Site.current = "v1"

    async def test_prune_persists_in_file_store(self):
        _Site.current = "v1"
        with TemporaryDirectory() as tmp:
            path = str(pathlib.Path(tmp) / "facts.jsonl")
            store = FileFactStore(path)
            first = await poll_source(self.url, store, extractor=self.extractor, prune_stale=True)
            self.assertEqual(len(store), 3)
            _Site.current = "v2"
            try:
                await poll_source(self.url, store, extractor=self.extractor, last_hash=first.hash, prune_stale=True)
            finally:
                _Site.current = "v1"
            reloaded = FileFactStore(path)
            self.assertFalse(any("24 by 7" in f.text for f in reloaded.all()))

    async def test_watch_session_events_and_stop(self):
        store = MemoryFactStore()
        session = WatchSession(
            self.url,
            store,
            interval_seconds=5,
            extractor=self.extractor,
            on_event=lambda e: None,
        )
        first = await session.tick()
        self.assertEqual(first.kind, "change")
        second = await session.tick()
        self.assertEqual(second.kind, "nochange")
        session.stop()

    async def test_watch_session_rejects_small_interval(self):
        with self.assertRaises(ValueError):
            WatchSession(self.url, MemoryFactStore(), interval_seconds=1)

    def test_version(self):
        import factag
        self.assertEqual(factag.VERSION, "0.1.2")


if __name__ == "__main__":
    unittest.main()
