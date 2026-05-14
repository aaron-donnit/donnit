import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import nspell from "nspell";

type Spellchecker = {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string, model?: string): unknown;
};

type SpellingNormalizationOptions = {
  protectedTerms?: string[];
};

type CorrectionCandidate = {
  original: string;
  suggestion: string;
  distance: number;
  similarity: number;
};

const requireFromAppRoot = createRequire(join(process.cwd(), "package.json"));
const dictionaryPath = dirname(requireFromAppRoot.resolve("dictionary-en-us/package.json"));
const spell = nspell({
  aff: readFileSync(join(dictionaryPath, "index.aff")),
  dic: readFileSync(join(dictionaryPath, "index.dic")),
}) as Spellchecker;

const defaultProtectedTerms = new Set([
  "api",
  "arr",
  "ats",
  "crm",
  "donnit",
  "eod",
  "eom",
  "eoq",
  "eow",
  "eoy",
  "hr",
  "kpi",
  "mrr",
  "nda",
  "ooo",
  "pto",
  "qbr",
  "rif",
  "sms",
  "sla",
  "sow",
]);

for (const term of Array.from(defaultProtectedTerms)) {
  spell.add(term);
  spell.add(term.toUpperCase());
}

function normalizeTerm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function protectedTermSet(options: SpellingNormalizationOptions = {}) {
  const terms = new Set(defaultProtectedTerms);
  for (const term of options.protectedTerms ?? []) {
    const normalized = normalizeTerm(term);
    if (normalized) terms.add(normalized);
  }
  return terms;
}

function levenshteinDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let upperLeft = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const upper = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        upperLeft + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      upperLeft = upper;
    }
  }
  return previous[b.length];
}

function spellingSimilarity(a: string, b: string) {
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - levenshteinDistance(a, b) / maxLength;
}

function preserveCase(original: string, suggestion: string) {
  if (original.toUpperCase() === original) return suggestion.toUpperCase();
  if (original.charAt(0).toUpperCase() === original.charAt(0)) {
    return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

function isLikelyProtectedProperNoun(token: string, offset: number, source: string) {
  if (!/^[A-Z][a-z]{2,}$/.test(token)) return false;
  const before = source.slice(0, offset).trimEnd();
  if (!before) return false;
  return !/[.!?]$/.test(before);
}

function correctionCandidates(token: string, options: SpellingNormalizationOptions = {}): CorrectionCandidate[] {
  const normalized = token.toLowerCase();
  if (
    normalized.length < 3 ||
    /\d/.test(normalized) ||
    protectedTermSet(options).has(normalized) ||
    spell.correct(token) ||
    spell.correct(normalized)
  ) {
    return [];
  }

  const suggestions = spell.suggest(normalized).slice(0, 8);
  if (suggestions.some((suggestion) => suggestion.toLowerCase() === normalized)) {
    return [];
  }

  return suggestions
    .map((suggestion) => {
      const lowerSuggestion = suggestion.toLowerCase();
      const distance = levenshteinDistance(normalized, lowerSuggestion);
      return {
        original: token,
        suggestion: lowerSuggestion,
        distance,
        similarity: spellingSimilarity(normalized, lowerSuggestion),
      };
    })
    .filter((candidate) => candidate.distance <= 1 || candidate.similarity >= 0.95)
    .sort((a, b) => a.distance - b.distance || b.similarity - a.similarity);
}

function bestCorrection(token: string, options: SpellingNormalizationOptions = {}) {
  const candidates = correctionCandidates(token, options);
  if (candidates.length === 0) return null;
  const [first, second] = candidates;
  if (!second || first.distance < second.distance || first.similarity - second.similarity >= 0.05) {
    return first;
  }
  return null;
}

export function normalizeEnglishSpelling(value: string, options: SpellingNormalizationOptions = {}) {
  return value.replace(/\b[A-Za-z][A-Za-z']{2,}\b/g, (token, offset: number) => {
    if (isLikelyProtectedProperNoun(token, offset, value)) return token;
    const correction = bestCorrection(token, options);
    return correction ? preserveCase(token, correction.suggestion) : token;
  });
}

export function englishSpellingClarification(value: string, options: SpellingNormalizationOptions = {}) {
  for (const match of Array.from(value.matchAll(/\b[A-Za-z][A-Za-z']{2,}\b/g))) {
    const token = match[0];
    if (isLikelyProtectedProperNoun(token, match.index ?? 0, value)) continue;
    const candidates = correctionCandidates(token, options);
    if (candidates.length > 1) {
      const suggestions = candidates.slice(0, 4).map((candidate) => candidate.suggestion);
      return {
        token,
        suggestions,
        question: `Did you mean ${suggestions.join(" or ")} for "${token}"?`,
      };
    }
  }
  return null;
}
