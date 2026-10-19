import asyncio
import json
import os
import tempfile
import unittest

from factag import (
    BudgetAssembler,
    DirectoryLoader,
    FACTS_FOOTER,
    FACTS_HEADER,
    Fact,
    FileFactStore,
    HeuristicExtractor,
    IngestionPipeline,
    KeywordRetriever,
    MemoryFactStore,
    RecursiveHeadingSplitter,
    TextLoader,
    html_to_text,
    normalize_facts,
)


def run(coro):
    return asyncio.run(coro)


class TestSplitter(unittest.TestCase):
    def test_heading_aware_chunks_respect_size(self):
        text = "\n".join(
            ["# Intro"] + ["Sentence about the product being fast and reliable."] * 20 +
            ["## Pricing"] + ["Starter costs $29 per month."] * 10
        )
        splitter = RecursiveHeadingSplitter(chunk_size=400, chunk_overlap=60)
        chunks = splitter.split_text(text)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(c) <= 400 for c in chunks))
        self.assertTrue(any(c.startswith("## Pricing") or "# Intro" in c for c in chunks))

    def test_overlap_error(self):
        with self.assertRaises(ValueError):
            RecursiveHeadingSplitter(chunk_size=100, chunk_overlap=100)


class TestLoaders(unittest.TestCase):
    def test_html_to_text_strips_chrome(self):
        html = "<html><head><title>Hi</title><script>var x=1;</script></head><body><nav>Menu</nav><h1>Hello</h1><p>World &amp; friends</p></body></html>"
        text = html_to_text(html)
        self.assertNotIn("var x", text)
        self.assertNotIn("Menu", text)
        self.assertIn("# Hello", text)
        self.assertIn("World & friends", text)

    def test_text_loader_detects_html(self):
        docs = TextLoader("<h1>Title</h1><p>Body text here.</p>").load()
        self.assertIn("Title", docs[0].page_content)

    def test_directory_loader_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "doc.md")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("# Facts\nThe starter plan costs $29 per month.\n")
            docs = DirectoryLoader(tmp).load()
            self.assertEqual(len(docs), 1)
            self.assertIn("$29", docs[0].page_content)
            self.assertTrue(docs[0].metadata["url"].startswith("file:///"))


class TestExtractor(unittest.TestCase):
    def test_heuristic_scores_and_categorizes(self):
        doc = TextLoader("Starter plan costs $29 per month. Support is at help@acme.io.").load()[0]
        facts = HeuristicExtractor().extract(doc)
        self.assertTrue(facts)
        pricing = [f for f in facts if "Starter" in f.text]
        self.assertEqual(pricing[0].category, "pricing")
        self.assertGreaterEqual(pricing[0].importance, 4)
        self.assertEqual(pricing[0].source_url, doc.metadata["url"])

    def test_heuristic_skips_trivia(self):
        doc = TextLoader("a the and of to").load()[0]
        self.assertEqual(HeuristicExtractor().extract(doc), [])


class TestNormalize(unittest.TestCase):
    def test_dedupe_keeps_higher_importance(self):
        dup1 = Fact(text="Starter plan costs $29 per month", importance=3, category="pricing", source_url="a")
        dup2 = Fact(text="starter plan costs $29 per month.", importance=5, category="pricing", source_url="a")
        other = Fact(text="Founded in 2020", importance=2, category="fact", source_url="b")
        kept = normalize_facts([dup1, dup2, other])
        self.assertEqual(len(kept), 2)
        self.assertEqual(kept[0].importance, 5)

    def test_max_per_source(self):
        facts = [Fact(text=f"fact number {i} about plan", importance=i % 5 + 1, category="fact", source_url="a") for i in range(6)]
        kept = normalize_facts(facts, max_per_source=3)
        self.assertEqual(len(kept), 3)


class TestStores(unittest.TestCase):
    def test_file_store_jsonl_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "facts.jsonl")
            store = FileFactStore(path)
            store.add([Fact(text="Starter costs $29", importance=5, category="pricing", source_url="https://a.example/p", chunk_id="0:::x")])
            store.flush()
            with open(path, encoding="utf-8") as fh:
                header = json.loads(fh.readline())
            self.assertEqual(header["_type"], "fag-store")
            reloaded = FileFactStore(path)
            facts = reloaded.all()
            self.assertEqual(len(facts), 1)
            self.assertEqual(facts[0].source_url, "https://a.example/p")
            self.assertEqual(facts[0].importance, 5)


class TestRetriever(unittest.TestCase):
    def setUp(self):
        self.store = MemoryFactStore([
            Fact(text="Starter plan costs $29 per month.", importance=5, category="pricing", source_url="https://a.example/p"),
            Fact(text="Business plan costs $99 per month.", importance=5, category="pricing", source_url="https://a.example/p"),
            Fact(text="The dashboard shows usage graphs.", importance=3, category="feature", source_url="https://a.example/f"),
        ])

    def test_context_block_format(self):
        block = run(BudgetAssembler(self.store, budget=4000).to_context("pricing"))
        self.assertTrue(block.startswith(FACTS_HEADER))
        self.assertTrue(block.endswith(FACTS_FOOTER))
        self.assertIn("importance=5 category=pricing", block)
        self.assertIn("https://a.example/p", block)

    def test_budget_overflow(self):
        included, omitted = run(BudgetAssembler(self.store, budget=250).assemble("pricing"))
        self.assertGreaterEqual(len(included), 1)
        self.assertGreaterEqual(len(omitted), 1)

    def test_empty_store_empty_string(self):
        self.assertEqual(run(BudgetAssembler(MemoryFactStore(), budget=4000).to_context("x")), "")

    def test_keyword_overflow(self):
        retriever = KeywordRetriever(self.store, k=1)
        hits = run(retriever.invoke("business plan pricing"))
        self.assertEqual(len(hits), 1)
        self.assertIn("Business", hits[0].text)


class TestPipeline(unittest.TestCase):
    def test_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "pricing.md"), "w", encoding="utf-8") as fh:
                fh.write(
                    "# Pricing\nStarter plan costs $29 per month and includes 3 API keys.\n\n"
                    "## Contact\nEmail support is at help@acme.io and replies arrive within one business day.\n"
                )
            store = FileFactStore(os.path.join(tmp, "facts.jsonl"))
            progress = []
            result = run(
                IngestionPipeline(
                    loader=DirectoryLoader(tmp, extensions=[".md"]),
                    splitter=RecursiveHeadingSplitter(chunk_size=500, chunk_overlap=80),
                    extractor=HeuristicExtractor(),
                    store=store,
                    on_progress=progress.append,
                ).run()
            )
            store.flush()
            self.assertEqual(result.documents, 1)
            self.assertGreaterEqual(result.raw, 2)
            self.assertEqual(result.kept, result.raw)
            self.assertEqual(progress, ["load", "split", "extract", "normalize", "store"])
            self.assertEqual(len(store.all()), result.kept)
            block = run(BudgetAssembler(store, budget=4000).to_context("what does starter cost?"))
            self.assertIn("$29", block)


if __name__ == "__main__":
    unittest.main()
