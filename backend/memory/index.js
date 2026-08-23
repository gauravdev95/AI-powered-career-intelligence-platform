/**
 * Career Memory Engine — public entry point.
 *
 *   Memory Store        MemoryStore.js        durable persistence (PostgreSQL)
 *   Memory Retriever    MemoryRetriever.js    hybrid vector + keyword candidate search
 *   Memory Ranker       MemoryRanker.js       six-signal, configurable scoring
 *   Memory Extractor    MemoryExtractor.js    raw material → candidate memories
 *   Memory Deduplicator MemoryDeduplicator.js skip / reinforce / supersede / conflict
 *   Context Builder     ContextBuilder.js     budgeted RAG context + citation resolution
 *   Memory Graph        MemoryGraph.js        relationships, wikilinks, graph projection
 *   Memory Engine       MemoryEngine.js       orchestration façade — import this
 *
 * Callers should use the `engine` export. The individual components are re-exported
 * for tests and for future callers that need finer-grained access.
 */

import * as MemoryEngine from './MemoryEngine.js'
import * as MemoryStore from './MemoryStore.js'
import * as MemoryRetriever from './MemoryRetriever.js'
import * as MemoryRanker from './MemoryRanker.js'
import * as MemoryExtractor from './MemoryExtractor.js'
import * as MemoryDeduplicator from './MemoryDeduplicator.js'
import * as ContextBuilder from './ContextBuilder.js'
import * as MemoryGraph from './MemoryGraph.js'

export {
  MemoryEngine, MemoryStore, MemoryRetriever, MemoryRanker,
  MemoryExtractor, MemoryDeduplicator, ContextBuilder, MemoryGraph,
}

export * from './types.js'

export const engine = MemoryEngine

export default MemoryEngine
