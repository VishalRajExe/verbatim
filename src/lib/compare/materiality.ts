/**
 * Materiality rules and deterministic significance floor (FR-7).
 *
 * Extracts material tokens:
 * - Currencies and amounts
 * - Numbers with units (days, months, years)
 * - Percentages
 * - Dates
 * - Modal obligation words (shall, must, may, will, shall not)
 * - Negations (not, never, neither, nor, no, cannot)
 * - "unlimited"
 * - Jurisdictions
 *
 * Rules:
 * - Any changed material token -> minimum MEDIUM
 * - Amount change >= 2x (or <= 0.5x) -> HIGH
 * - Direction change in liability / payment / termination / indemnity / governing_law -> HIGH
 * - Deterministic floor: AI may raise significance, never lower it below floor.
 */

import { Significance, ChangeType } from "./align";

export interface MaterialTokens {
  amounts: { raw: string; value: number; currency?: string }[];
  numbersWithUnits: string[];
  percentages: string[];
  dates: string[];
  modals: string[];
  negations: string[];
  unlimited: boolean;
  jurisdictions: string[];
}

export interface MaterialityResult {
  floor: Significance;
  reasons: string[];
  tokensOld: MaterialTokens;
  tokensNew: MaterialTokens;
}

const SIGNIFICANCE_RANK: Record<Significance, number> = {
  COSMETIC: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * Enforces that AI cannot lower significance below the deterministic floor.
 */
export function enforceSignificanceFloor(
  aiSignificance: Significance | string,
  floor: Significance
): Significance {
  const normAi = (aiSignificance?.toUpperCase() as Significance) || "LOW";
  const validAi: Significance =
    normAi in SIGNIFICANCE_RANK ? normAi : "LOW";

  const aiRank = SIGNIFICANCE_RANK[validAi] ?? 1;
  const floorRank = SIGNIFICANCE_RANK[floor] ?? 1;

  return aiRank >= floorRank ? validAi : floor;
}

const CURRENCY_REGEX = /(?:AED|USD|EUR|GBP|\$|€|£|Dirhams?)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:AED|USD|EUR|GBP|Dirhams?)/gi;
const UNIT_REGEX = /\b(\d+(?:,\d+)*(?:\.\d+)?)\s*(days?|business\s+days?|calendar\s+days?|months?|years?|weeks?|hours?)\b/gi;
const PERCENT_REGEX = /\b(\d+(?:\.\d+)?)\s*(?:%|percent)\b/gi;
const DATE_REGEX = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/gi;
const MODAL_REGEX = /\b(shall\s+not|must\s+not|may\s+not|shall|must|may|will)\b/gi;
const NEGATION_REGEX = /\b(not|never|neither|nor|cannot|no\s+longer|no)\b/gi;
const JURISDICTION_REGEX = /\b(Dubai|United\s+Arab\s+Emirates|UAE|DIFC|ADGM|Abu\s+Dhabi|England(?:\s+and\s+Wales)?|Delaware|New\s+York|California|Singapore|United\s+Kingdom)\b/gi;

export function extractMaterialTokens(text: string | null): MaterialTokens {
  if (!text) {
    return {
      amounts: [],
      numbersWithUnits: [],
      percentages: [],
      dates: [],
      modals: [],
      negations: [],
      unlimited: false,
      jurisdictions: [],
    };
  }

  // Amounts
  const amounts: { raw: string; value: number; currency?: string }[] = [];
  let m: RegExpExecArray | null;
  const currRegex = new RegExp(CURRENCY_REGEX);
  while ((m = currRegex.exec(text)) !== null) {
    const rawVal = (m[1] || m[2] || "").replace(/,/g, "");
    const val = parseFloat(rawVal);
    if (!isNaN(val)) {
      amounts.push({ raw: m[0].trim(), value: val });
    }
  }

  // Numbers with units
  const numbersWithUnits: string[] = [];
  const uRegex = new RegExp(UNIT_REGEX);
  while ((m = uRegex.exec(text)) !== null) {
    numbersWithUnits.push(m[0].toLowerCase().trim());
  }

  // Percentages
  const percentages: string[] = [];
  const pRegex = new RegExp(PERCENT_REGEX);
  while ((m = pRegex.exec(text)) !== null) {
    percentages.push(m[0].toLowerCase().trim());
  }

  // Dates
  const dates: string[] = [];
  const dRegex = new RegExp(DATE_REGEX);
  while ((m = dRegex.exec(text)) !== null) {
    dates.push(m[0].trim());
  }

  // Modals
  const modals: string[] = [];
  const mRegex = new RegExp(MODAL_REGEX);
  while ((m = mRegex.exec(text)) !== null) {
    modals.push(m[0].toLowerCase().trim());
  }

  // Negations
  const negations: string[] = [];
  const nRegex = new RegExp(NEGATION_REGEX);
  while ((m = nRegex.exec(text)) !== null) {
    negations.push(m[0].toLowerCase().trim());
  }

  // Unlimited
  const unlimited = /\bunlimited\b/i.test(text);

  // Jurisdictions
  const jurisdictions: string[] = [];
  const jRegex = new RegExp(JURISDICTION_REGEX);
  while ((m = jRegex.exec(text)) !== null) {
    jurisdictions.push(m[0].trim());
  }

  return {
    amounts,
    numbersWithUnits,
    percentages,
    dates,
    modals,
    negations,
    unlimited,
    jurisdictions,
  };
}

/**
 * Calculates the deterministic materiality floor and rationale for a change.
 */
export function calculateMaterialityFloor(
  type: ChangeType,
  oldText: string | null,
  newText: string | null,
  category?: string | null
): MaterialityResult {
  const tokensOld = extractMaterialTokens(oldText);
  const tokensNew = extractMaterialTokens(newText);
  const reasons: string[] = [];

  const cat = (category || "").toLowerCase();

  // 1. ADDED or REMOVED
  if (type === "ADDED" || type === "REMOVED") {
    const isCriticalCat = ["liability", "indemnity", "termination", "governing_law"].includes(cat);
    if (isCriticalCat) {
      reasons.push(`${type} clause in critical category (${cat})`);
      return { floor: "HIGH", reasons, tokensOld, tokensNew };
    }
    reasons.push(`${type} clause`);
    return { floor: "MEDIUM", reasons, tokensOld, tokensNew };
  }

  // 2. MOVED
  if (type === "MOVED") {
    reasons.push("Clause moved to a different position without substantive change");
    return { floor: "LOW", reasons, tokensOld, tokensNew };
  }

  // 3. MODIFIED
  // Check amounts and 2x factor
  if (tokensOld.amounts.length > 0 && tokensNew.amounts.length > 0) {
    for (const a1 of tokensOld.amounts) {
      for (const a2 of tokensNew.amounts) {
        if (a1.value !== a2.value) {
          const ratio = Math.max(a1.value, a2.value) / Math.max(1, Math.min(a1.value, a2.value));
          if (ratio >= 2.0) {
            reasons.push(`Amount changed by factor of ${ratio.toFixed(1)}x (${a1.raw} -> ${a2.raw})`);
            return { floor: "HIGH", reasons, tokensOld, tokensNew };
          } else {
            reasons.push(`Amount changed (${a1.raw} -> ${a2.raw})`);
            return { floor: "MEDIUM", reasons, tokensOld, tokensNew };
          }
        }
      }
    }
  } else if (tokensOld.amounts.length !== tokensNew.amounts.length) {
    reasons.push("Monetary amount added or removed");
    return { floor: "HIGH", reasons, tokensOld, tokensNew };
  }

  // Check unlimited liability shift
  if (tokensOld.unlimited !== tokensNew.unlimited && (cat === "liability" || cat === "indemnity")) {
    reasons.push("Liability limit shifted between capped and unlimited");
    return { floor: "HIGH", reasons, tokensOld, tokensNew };
  }

  // Check direction change in critical categories: liability, payment, termination, indemnity, governing_law
  const isHighRiskCategory = ["liability", "payment", "termination", "indemnity", "governing_law"].includes(cat);

  // Direction change: modal flip (shall -> shall not, may -> shall, must not -> may)
  const normModalOld = tokensOld.modals.map((m) => m === "will" ? "shall" : m);
  const normModalNew = tokensNew.modals.map((m) => m === "will" ? "shall" : m);
  const hasModalChange = normModalOld.join(",") !== normModalNew.join(",");
  const hasNegationChange =
    tokensOld.negations.length !== tokensNew.negations.length ||
    tokensOld.negations.join(",") !== tokensNew.negations.join(",");

  if (isHighRiskCategory && (hasModalChange || hasNegationChange)) {
    reasons.push(`Directional obligation change in ${cat} clause`);
    return { floor: "HIGH", reasons, tokensOld, tokensNew };
  }

  // Check jurisdiction changes
  if (tokensOld.jurisdictions.join(",") !== tokensNew.jurisdictions.join(",")) {
    reasons.push("Governing law jurisdiction changed");
    return { floor: "HIGH", reasons, tokensOld, tokensNew };
  }

  // Check numbers with units (e.g. notice period 30 days -> 60 days)
  if (tokensOld.numbersWithUnits.join(",") !== tokensNew.numbersWithUnits.join(",")) {
    reasons.push("Duration, time period, or unit numbers changed");
    return { floor: "MEDIUM", reasons, tokensOld, tokensNew };
  }

  // Check percentages (e.g. interest rate 1.5% -> 2%)
  if (tokensOld.percentages.join(",") !== tokensNew.percentages.join(",")) {
    reasons.push("Percentage changed");
    return { floor: "MEDIUM", reasons, tokensOld, tokensNew };
  }

  // Check dates
  if (tokensOld.dates.join(",") !== tokensNew.dates.join(",")) {
    reasons.push("Date changed");
    return { floor: "MEDIUM", reasons, tokensOld, tokensNew };
  }

  // Any changed modal or negation in any category
  if (hasModalChange || hasNegationChange) {
    reasons.push("Obligation words or negations modified");
    return { floor: "MEDIUM", reasons, tokensOld, tokensNew };
  }

  // Pure rewording without material token changes
  reasons.push("Wording updated with no material token modifications");
  return { floor: "LOW", reasons, tokensOld, tokensNew };
}
