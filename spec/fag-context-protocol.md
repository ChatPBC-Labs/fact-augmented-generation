# FAG Context Protocol v0.1

Status: Draft · Version: 0.1.0

## Purpose

The FAG Context Protocol defines the shape of facts produced by any FAG
ingestion pipeline and the context block handed to an LLM at generation
time. It exists so that any implementation — TypeScript, Python, or a
custom server — produces interchangeable output.

## Fact object

```json
{
  "text": "The Starter plan costs $29 per month.",
  "importance": 5,
  "category": "pricing",
  "sourceUrl": "https://example.com/pricing",
  "chunkId": "pricing#costs-1",
  "metadata": {}
}
```

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `text` | string | yes | 1–3 sentences, self-contained, present tense, no pronouns referring to the page |
| `importance` | integer 1–5 | yes | 5 = identity/pricing/limits, 4 = capabilities, 3 = procedures, 2 = background, 1 = trivia |
| `category` | string | yes | lowercase slug: `pricing`, `feature`, `policy`, `limit`, `contact`, `fact`, … |
| `sourceUrl` | string | yes | absolute URL of origin, or `file://…` for local sources |
| `chunkId` | string | no | provenance: `#heading-path#paragraph-index` |
| `metadata` | object | no | loader/splitter extras (title, lang, crawledAt) |

## Store file (JSONL)

One fact per line, UTF-8, `\n` separated. First line may be a header object
`{"_type":"fag-store","version":1}` for forward compatibility.

## Context block

Assemblers emit exactly:

```
=== VERIFIED FACTS ===
- (sourceUrl) importance=N category=category fact text
- (sourceUrl) importance=N category=category fact text
=== END VERIFIED FACTS ===
```

Rules:

1. Facts ordered by `importance` descending; ties broken by store order.
2. Total block size ≤ configured budget (characters, UTF-16 code units).
3. A fact is never truncated mid-sentence; whole facts only.
4. Empty store ⇒ assembler returns `""` (caller omits the block).
5. If the budget cannot hold all facts, the assembler MUST report
   `{ included, omitted }` so callers can fall back to a keyword
   retriever for the omitted set.

## Overflow

When `included < total`, implementations SHOULD expose a keyword
retriever (`KeywordRetriever`) that ranks omitted facts against the
query (token overlap, case-folded, stopword-filtered) and returns top-k
to append within any remaining budget.

## Compatibility

Minor versions may add fields. Consumers MUST ignore unknown fields.
Removals or type changes require a major version bump.
