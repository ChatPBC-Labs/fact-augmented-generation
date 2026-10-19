# factag-cli

Command-line interface for Fact-Augmented Generation.

`
npm install -g factag-cli

factag index ./docs --out facts.jsonl          # load → split → extract → normalize → store
factag ask "what does the business plan cost?" --facts facts.jsonl --budget 4000
factag stats --facts facts.jsonl
factag export --facts facts.jsonl --format jsonl
`

The extracted context prints to stdout — pipe it into any LLM you already use. Zero keys by default (heuristic extractor); --llm --model <m> --base-url <url> --key-env <ENV_VAR> enables LLM extraction.

Docs: https://github.com/factag-generator/fact-augmented-generation
