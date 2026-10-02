/**
 * Clause alignment module for document comparison (FR-7).
 *
 * Aligns clauses between older (A) and newer (B) versions:
 * 1. Normalized identical text
 * 2. Moved identical text (detected via Longest Increasing Subsequence)
 * 3. Same number / heading with similarity >= 0.5 -> MODIFIED
 * 4. Best bigram-Dice similarity >= 0.6 -> MODIFIED
 * 5. Remaining in A -> REMOVED
 * 6. Remaining in B -> ADDED
 * 7. Cosmetic equality after stripping case/punctuation/numbering -> COSMETIC
 */

import { ClauseUnit } from "./clauses";

export type ChangeType = "ADDED" | "REMOVED" | "MODIFIED" | "MOVED";
export type Significance = "HIGH" | "MEDIUM" | "LOW" | "COSMETIC";

export interface AlignedChange {
  id: string;
  orderIdx: number;
  type: ChangeType;
  significance?: Significance;
  similarity: number;
  aClause?: ClauseUnit;
  bClause?: ClauseUnit;
}

export interface AlignmentResult {
  changes: AlignedChange[];
  unchangedCount: number;
  unchangedClauses: { aClause: ClauseUnit; bClause: ClauseUnit }[];
}

/**
 * Computes Sørensen-Dice coefficient on character bigrams (0.0 to 1.0).
 */
export function bigramDice(a: string, b: string): number {
  if (a === b) return 1.0;
  const s1 = a.toLowerCase().replace(/\s+/g, " ").trim();
  const s2 = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };

  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);

  let intersection = 0;
  for (const [bg, count] of b1.entries()) {
    const c2 = b2.get(bg);
    if (c2 !== undefined) {
      intersection += Math.min(count, c2);
    }
  }

  const total = (s1.length - 1) + (s2.length - 1);
  return total > 0 ? (2 * intersection) / total : 0.0;
}

function exactNormalize(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function cosmeticNormalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(?:section|article|clause)?\s*[\d.a-z\-:()]+\s*/i, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(s: string | null): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Finds the Longest Increasing Subsequence of pairs that minimizes displacement.
 */
function findOptimalLisIndices(pairs: { aIdx: number; bIdx: number }[]): Set<number> {
  const n = pairs.length;
  if (n === 0) return new Set();

  const dp = new Array(n).fill(1);
  const cost = new Array(n).fill(0);
  const parent = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    cost[i] = Math.abs(pairs[i].bIdx - pairs[i].aIdx);
    for (let j = 0; j < i; j++) {
      if (pairs[j].bIdx < pairs[i].bIdx) {
        const newLen = dp[j] + 1;
        const newCost = cost[j] + Math.abs(pairs[i].bIdx - pairs[i].aIdx);
        if (newLen > dp[i] || (newLen === dp[i] && newCost < cost[i])) {
          dp[i] = newLen;
          cost[i] = newCost;
          parent[i] = j;
        }
      }
    }
  }

  let bestIdx = 0;
  for (let i = 1; i < n; i++) {
    if (dp[i] > dp[bestIdx] || (dp[i] === dp[bestIdx] && cost[i] < cost[bestIdx])) {
      bestIdx = i;
    }
  }

  const lis = new Set<number>();
  let curr = bestIdx;
  while (curr >= 0) {
    lis.add(curr);
    curr = parent[curr];
  }
  return lis;
}

/**
 * Aligns two sets of clauses into changes (Added, Removed, Modified, Moved) and unchanged clauses.
 */
export function alignClauses(aClauses: ClauseUnit[], bClauses: ClauseUnit[]): AlignmentResult {
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  // 1. Identical text matching
  const exactPairs: { aIdx: number; bIdx: number }[] = [];
  for (let i = 0; i < aClauses.length; i++) {
    const normA = exactNormalize(aClauses[i].text);
    for (let j = 0; j < bClauses.length; j++) {
      if (usedB.has(j)) continue;
      const normB = exactNormalize(bClauses[j].text);
      if (normA === normB) {
        exactPairs.push({ aIdx: i, bIdx: j });
        usedA.add(i);
        usedB.add(j);
        break;
      }
    }
  }

  // 2. Identify moves among exact matches via optimal LIS
  // Sort pairs by aIdx
  exactPairs.sort((p1, p2) => p1.aIdx - p2.aIdx);
  const lisIndices = findOptimalLisIndices(exactPairs);

  const unchangedClauses: { aClause: ClauseUnit; bClause: ClauseUnit }[] = [];
  const movedChanges: AlignedChange[] = [];

  for (let k = 0; k < exactPairs.length; k++) {
    const pair = exactPairs[k];
    const a = aClauses[pair.aIdx];
    const b = bClauses[pair.bIdx];

    if (lisIndices.has(k)) {
      // Kept relative order: UNCHANGED
      unchangedClauses.push({ aClause: a, bClause: b });
    } else {
      // Relative order shifted: MOVED
      movedChanges.push({
        id: `change-moved-${a.id}-${b.id}`,
        orderIdx: b.order,
        type: "MOVED",
        similarity: 1.0,
        aClause: a,
        bClause: b,
      });
    }
  }

  // 3. Same number / heading and similarity >= 0.5 -> MODIFIED
  const modifiedChanges: AlignedChange[] = [];
  for (let i = 0; i < aClauses.length; i++) {
    if (usedA.has(i)) continue;
    const a = aClauses[i];
    const aHead = normalizeTitle(a.heading);
    const aNum = a.number ? a.number.replace(/[^\w]/g, "") : null;

    let bestMatchIdx = -1;
    let bestSimilarity = 0.5;

    for (let j = 0; j < bClauses.length; j++) {
      if (usedB.has(j)) continue;
      const b = bClauses[j];
      const bHead = normalizeTitle(b.heading);
      const bNum = b.number ? b.number.replace(/[^\w]/g, "") : null;

      const titleMatches = aHead && bHead && aHead === bHead;
      const numMatches = aNum && bNum && aNum === bNum;

      if (titleMatches || numMatches) {
        const sim = bigramDice(a.text, b.text);
        if (sim >= bestSimilarity) {
          bestSimilarity = sim;
          bestMatchIdx = j;
        }
      }
    }

    if (bestMatchIdx >= 0) {
      usedA.add(i);
      usedB.add(bestMatchIdx);
      const b = bClauses[bestMatchIdx];
      modifiedChanges.push({
        id: `change-mod-${a.id}-${b.id}`,
        orderIdx: b.order,
        type: "MODIFIED",
        similarity: bestSimilarity,
        aClause: a,
        bClause: b,
      });
    }
  }

  // 4. Best bigram-Dice similarity >= 0.6 -> MODIFIED
  for (let i = 0; i < aClauses.length; i++) {
    if (usedA.has(i)) continue;
    const a = aClauses[i];

    let bestMatchIdx = -1;
    let bestSimilarity = 0.6;

    for (let j = 0; j < bClauses.length; j++) {
      if (usedB.has(j)) continue;
      const b = bClauses[j];
      const sim = bigramDice(a.text, b.text);
      if (sim >= bestSimilarity) {
        bestSimilarity = sim;
        bestMatchIdx = j;
      }
    }

    if (bestMatchIdx >= 0) {
      usedA.add(i);
      usedB.add(bestMatchIdx);
      const b = bClauses[bestMatchIdx];
      modifiedChanges.push({
        id: `change-mod-${a.id}-${b.id}`,
        orderIdx: b.order,
        type: "MODIFIED",
        similarity: bestSimilarity,
        aClause: a,
        bClause: b,
      });
    }
  }

  // 5. Remaining in A -> REMOVED
  const removedChanges: AlignedChange[] = [];
  for (let i = 0; i < aClauses.length; i++) {
    if (!usedA.has(i)) {
      const a = aClauses[i];
      removedChanges.push({
        id: `change-rem-${a.id}`,
        orderIdx: 100000 + a.order,
        type: "REMOVED",
        similarity: 0,
        aClause: a,
      });
    }
  }

  // 6. Remaining in B -> ADDED
  const addedChanges: AlignedChange[] = [];
  for (let j = 0; j < bClauses.length; j++) {
    if (!usedB.has(j)) {
      const b = bClauses[j];
      addedChanges.push({
        id: `change-add-${b.id}`,
        orderIdx: b.order,
        type: "ADDED",
        similarity: 0,
        bClause: b,
      });
    }
  }

  // 7. Check cosmetic equality for modified changes
  for (const ch of modifiedChanges) {
    if (ch.aClause && ch.bClause) {
      if (cosmeticNormalize(ch.aClause.text) === cosmeticNormalize(ch.bClause.text)) {
        ch.significance = "COSMETIC";
      }
    }
  }

  // Combine and sort changes for display by orderIdx
  const allChanges: AlignedChange[] = [
    ...movedChanges,
    ...modifiedChanges,
    ...addedChanges,
    ...removedChanges,
  ];

  allChanges.sort((c1, c2) => c1.orderIdx - c2.orderIdx);

  // Re-index orderIdx consecutively 0..N
  allChanges.forEach((ch, idx) => {
    ch.orderIdx = idx;
  });

  return {
    changes: allChanges,
    unchangedCount: unchangedClauses.length,
    unchangedClauses,
  };
}
