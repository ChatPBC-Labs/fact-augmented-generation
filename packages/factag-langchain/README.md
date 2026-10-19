# factag-langchain

Drop-in FagRetriever for [LangChain](https://js.langchain.com) — serve verified FAG facts wherever a retriever is expected.

`	s
import { FagRetriever } from "factag-langchain";

const retriever = new FagRetriever(store, { budget: 8000, overflow: 2 });
const docs = await retriever.invoke("what does the business plan cost?");
// LangChain Documents with metadata: { source, importance, category }
chain = retriever.pipe(chatModel).pipe(new StringOutputParser());
`

Docs: https://github.com/factag-generator/fact-augmented-generation
