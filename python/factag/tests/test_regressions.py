import asyncio
import os
import tempfile
import unittest

from factag import (
    BudgetAssembler,
    DirectoryLoader,
    Fact,
    FileFactStore,
    HeuristicExtractor,
    IngestionPipeline,
    MemoryFactStore,
    RecursiveHeadingSplitter,
    html_to_text,
)


def run(coro):
    return asyncio.run(coro)


def make_doc(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def ingest(tmp, store):
    return IngestionPipeline(
        loader=DirectoryLoader(tmp, extensions=[".md"]),
        splitter=RecursiveHeadingSplitter(chunk_size=600, chunk_overlap=80),
        extractor=HeuristicExtractor(),
        store=store,
    ).run()


class TestRegressions(unittest.TestCase):
    def test_memory_store_seed_arguments(self):
        store = MemoryFactStore([Fact(text="seeded fact", importance=3, category="fact", source_url="s")])
        self.assertEqual(len(store), 1)

    def test_reingest_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            make_doc(os.path.join(tmp, "a.md"), "# P\nStarter plan costs $29 per month.\n")
            store = FileFactStore(os.path.join(tmp, "facts.jsonl"))
            r1 = run(ingest(tmp, store))
            r2 = run(ingest(tmp, store))
            r3 = run(ingest(tmp, store))
            self.assertEqual(r1.stats.get("skippedFromStore", 0), 0)
            self.assertEqual(r2.kept, 0, "second run adds no new facts")
            self.assertEqual(r2.stats["skippedFromStore"], r1.kept)
            self.assertEqual(r3.kept, 0)
            self.assertEqual(len(store), r1.kept)

    def test_assembler_k_lexical_focus(self):
        async def go():
            store = MemoryFactStore([
                Fact(text="The Standard plan costs $49 per month.", importance=5, category="pricing", source_url="s1"),
                Fact(text="Retention: logs are kept for 30 days.", importance=5, category="policy", source_url="s2"),
                Fact(text="SSO via SAML is available on Scale.", importance=4, category="feature", source_url="s3"),
            ])
            with_q, _ = await BudgetAssembler(store, budget=800).assemble("sso saml", k=1)
            self.assertIn("SAML", with_q[0].text)
            without_q, _ = await BudgetAssembler(store, budget=800).assemble("", k=2)
            self.assertEqual([f.importance for f in without_q], [5, 5])

        run(go())

    def test_html_head_title_strip(self):
        text = html_to_text(
            "<html><head><title>OnlyHeadText</title><style>.x{}</style></head><body><p>visible fact $12</p></body></html>"
        )
        self.assertNotIn("OnlyHeadText", text)
        self.assertIn("visible fact", text)

    def test_yen_currency_category_pricing_real(self):
        from factag import TextLoader

        doc = TextLoader("国际方案的价格是 ¥399 每月，包含 10 个 API 密钥。", fmt="text").load()[0]
        facts = HeuristicExtractor().extract(doc)
        self.assertTrue(facts)
        self.assertEqual(facts[0].category, "pricing")


if __name__ == "__main__":
    unittest.main()
