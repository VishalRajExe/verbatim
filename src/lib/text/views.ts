/**
 * Lazily computed, in-memory LRU-cached text views per document.
 * Architecture.md SS6: keep view and join view built once, cached by documentId.
 *
 * INVARIANT (I-4): Only exact substring matching is ever applied to these views.
 */
import { NormView, keepView, joinView, looseKey } from "./normalize";

export interface DocumentViews {
  keep: NormView;
  join: NormView;
  loose: NormView;
}

// Simple LRU cache: evicts the oldest entry when capacity is reached.
const CACHE_CAPACITY = 50;
const cache = new Map<string, DocumentViews>();

function evictIfFull(): void {
  if (cache.size >= CACHE_CAPACITY) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

/**
 * Build and cache all three views for a canonical text string.
 * @param documentId Used as cache key.
 * @param canonicalText The full canonical text of the document.
 */
export function getViews(documentId: string, canonicalText: string): DocumentViews {
  const cached = cache.get(documentId);
  if (cached !== undefined) {
    // Refresh LRU order
    cache.delete(documentId);
    cache.set(documentId, cached);
    return cached;
  }

  evictIfFull();

  const views: DocumentViews = {
    keep: keepView(canonicalText),
    join: joinView(canonicalText),
    loose: looseKey(canonicalText),
  };
  cache.set(documentId, views);
  return views;
}

/** Invalidate cache entry (call when document is deleted or re-indexed). */
export function invalidateViews(documentId: string): void {
  cache.delete(documentId);
}
