# RAG ingestion

Enable private exports with `corpus.rag.enabled: true` and a configured Astro `site` (without
one, the build reports `corpus-rag-origin-missing` and skips RAG). Read
`.astro/aeo-cache/rag-v1/index-v1.json`, then its listed relative JSONL files. The filenames encode
locale/version tuples without trusting labels as filesystem paths. Check `buildTimeIncomplete`
and `inventoryComplete` before claiming full coverage. Match `buildDigest` against the page
snapshot or trace. Ignore orphaned files not listed by the current index.

The records contain full-page and chunk text. Select only `kind: 'chunk'` for ordinary embedding
ingestion, or only `kind: 'page'` if your application will do its own chunking. Embedding both
kinds duplicates content. Oversized chunks remain whole; decide explicitly how your model handles
them. `tokenizer.approximate` distinguishes approximate counts from a configured counter, and
`tokenizerFallback.reason` discloses a configured counter's failure. Counts refer to the exact
record text, not a model prompt with extra instructions or metadata.

A page ID hashes its public canonical URL, route pathname, locale and version. Distinct routes
sharing an authored canonical remain distinct records. A chunk ID appends its ordinal,
so preceding insertions can move later chunk identities. Hashes disclose changed text even when
IDs remain stable. Query strings, credentials and fragments are not identity inputs. Metadata
replacements preserve URL/path/locale/version identity and all measured fields. For example:

```js
const labels = {
  name: 'rag-labels', apiVersion: 1,
  setup(api) {
    api.on('rag:record', ({ value }) => ({
      action: 'replace',
      value: { ...value, metadata: { ...value.metadata, category: 'documentation' } },
    }), { cache: { pure: true, version: '1' } });
  },
};
```

Trusted runtime hooks must register the same hook in an importable API-version-1 runtime module.
Malformed replacements or explicit isolation withhold the affected export rather than pretending
a partial answer is complete. `drop` removes only the current record, not its page's other records.

## Framework mappings

These examples run in your ingestion application with its own framework dependencies. Astro-AEO
adds neither framework. They only construct documents: no model requests, embeddings or uploads
are performed. Select a file from the private index, or a public JSONL artifact after explicitly
setting `publish: true`.

```python
import json

with open("records.jsonl", encoding="utf-8") as source:
    chunks = [r for line in source if (r := json.loads(line))["kind"] == "chunk"]

# LangChain
from langchain_core.documents import Document as LangChainDocument
langchain_documents = [
    LangChainDocument(page_content=r["text"], metadata={**r["metadata"], "aeo_id": r["id"]})
    for r in chunks
]

# LlamaIndex
from llama_index.core import Document as LlamaDocument
llama_documents = [
    LlamaDocument(text=r["text"], metadata=r["metadata"])
    for r in chunks
]
for document, record in zip(llama_documents, chunks):
    document.id_ = record["id"]
```

Mappings checked against the primary [LangChain document reference](https://reference.langchain.com/python/langchain-core/documents/base/Document)
and [LlamaIndex document guide](https://developers.llamaindex.ai/python/framework/module_guides/loading/documents_and_nodes/usage_documents/)
on 2026-10-03. Filter null metadata values if your vector store does not accept them. Reuse the
provided chunks to avoid silently splitting fences again in a framework's default splitter.
