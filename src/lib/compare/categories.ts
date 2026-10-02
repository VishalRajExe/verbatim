/**
 * Clause categorization for document comparison (FR-7).
 *
 * Categorizes clauses into standard legal taxonomy:
 * - liability
 * - payment
 * - termination
 * - indemnity
 * - confidentiality
 * - governing_law
 * - warranties
 * - intellectual_property
 * - dispute_resolution
 * - data_protection
 * - general
 *
 * Seeded from legal-lens clause templates and rag-contract-analyzer risk_terms.yaml.
 */

interface CategoryRule {
  category: string;
  headingPatterns: RegExp[];
  bodyPatterns: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "liability",
    headingPatterns: [
      /\b(liab|limitation of liability|damages|cap on liability|consequential)\b/i,
    ],
    bodyPatterns: [
      /\bunlimited\s+liab/i,
      /\bliability\s+shall\s+not\s+exceed\b/i,
      /\b(limitation|limit)\s+of\s+liability\b/i,
      /\baggregate\s+liability\b/i,
      /\bindirect|consequential|punitive|special\s+damages\b/i,
      /\bliable\s+for\s+any\s+loss\b/i,
    ],
  },
  {
    category: "indemnity",
    headingPatterns: [
      /\b(indemnif|hold\s+harmless|defense\s+and\s+indemnification)\b/i,
    ],
    bodyPatterns: [
      /\b(indemnif|hold\s+harmless|save\s+harmless)\b/i,
      /\bdefend.{0,30}harmless\b/i,
      /\bthird[- ]party\s+claims?\b/i,
    ],
  },
  {
    category: "termination",
    headingPatterns: [
      /\b(terminat|term\s+and\s+termination|cancellation|expiration)\b/i,
    ],
    bodyPatterns: [
      /\bterminate.{0,40}(for\s+cause|convenience|without\s+cause)\b/i,
      /\bnotice\s+of\s+termination\b/i,
      /\btermination\s+notice\b/i,
      /\buncured\s+breach\b/i,
      /\beffect\s+of\s+termination\b/i,
    ],
  },
  {
    category: "payment",
    headingPatterns: [
      /\b(payment|fees|invoicing|compensation|pricing|billing|charges|rates)\b/i,
    ],
    bodyPatterns: [
      /\b(undisputed\s+invoices?|pay\s+all\s+invoices?|interest\s+at\s+\d|due\s+date|late\s+payments?)\b/i,
      /\b(net\s+\d+|payable\s+within\s+\d+\s+days)\b/i,
      /\b(taxes\s+and\s+duties|reimbursement\s+of\s+expenses)\b/i,
    ],
  },
  {
    category: "confidentiality",
    headingPatterns: [
      /\b(confidential|non[- ]disclosure|proprietary\s+information|secrecy)\b/i,
    ],
    bodyPatterns: [
      /\b(confidential\s+information|proprietary\s+information|trade\s+secrets?)\b/i,
      /\b(recipient|disclosing\s+party).{0,30}confidential/i,
      /\bmaintain\s+(the\s+)?confidentiality\b/i,
    ],
  },
  {
    category: "governing_law",
    headingPatterns: [
      /\b(governing\s+law|applicable\s+law|jurisdiction|venue)\b/i,
    ],
    bodyPatterns: [
      /\bgoverned\s+by\s+and\s+construed\s+in\s+accordance\s+with\b/i,
      /\blaws\s+of\s+(the\s+)?(United\s+Arab\s+Emirates|Dubai|England|Delaware|New\s+York|Singapore)\b/i,
      /\bcourts\s+of\s+(Dubai|DIFC|ADGM|England|Delaware|London)\b/i,
      /\bexclusive\s+jurisdiction\b/i,
    ],
  },
  {
    category: "dispute_resolution",
    headingPatterns: [
      /\b(dispute|dispute\s+resolution|arbitration|mediation|litigation)\b/i,
    ],
    bodyPatterns: [
      /\bbinding\s+arbitration\b/i,
      /\b(DIFC-LCIA|LCIA|ICC|DIAC|AAA|UNCITRAL)\b/i,
      /\barbitration\s+in\s+Dubai\b/i,
      /\brules\s+of\s+arbitration\b/i,
    ],
  },
  {
    category: "warranties",
    headingPatterns: [
      /\b(warrant|representations?|disclaimer\s+of\s+warranties)\b/i,
    ],
    bodyPatterns: [
      /\b(warrant\s+and\s+represent|as[- ]is\s+basis|merchantability|fitness\s+for\s+a\s+particular\s+purpose)\b/i,
      /\bno\s+other\s+warranties\b/i,
    ],
  },
  {
    category: "data_protection",
    headingPatterns: [
      /\b(data\s+protection|security|privacy|gdpr|customer\s+data)\b/i,
    ],
    bodyPatterns: [
      /\b(personal\s+data|customer\s+data|data\s+safeguards|security\s+measures)\b/i,
      /\b(administrative,\s+physical,\s+and\s+technical\s+safeguards)\b/i,
    ],
  },
  {
    category: "intellectual_property",
    headingPatterns: [
      /\b(intellectual\s+property|ip\s+rights|patents?|copyrights?|trademarks?|ownership)\b/i,
    ],
    bodyPatterns: [
      /\b(ownership\s+of\s+deliverables|work\s+made\s+for\s+hire|ip\s+infringement)\b/i,
      /\bretain\s+all\s+rights,\s+title\s+and\s+interest\b/i,
    ],
  },
];

/**
 * Categorizes a clause based on its heading and text body.
 */
export function categorizeClause(text: string, heading?: string | null): string {
  const head = heading || "";
  const combined = `${head}\n${text}`;

  // 1. Check heading first
  if (head) {
    for (const rule of CATEGORY_RULES) {
      for (const hp of rule.headingPatterns) {
        if (hp.test(head)) {
          return rule.category;
        }
      }
    }
  }

  // 2. Check body patterns
  for (const rule of CATEGORY_RULES) {
    for (const bp of rule.bodyPatterns) {
      if (bp.test(combined)) {
        return rule.category;
      }
    }
  }

  // 3. Fallback check on heading words
  for (const rule of CATEGORY_RULES) {
    for (const hp of rule.headingPatterns) {
      if (hp.test(combined)) {
        return rule.category;
      }
    }
  }

  return "general";
}
