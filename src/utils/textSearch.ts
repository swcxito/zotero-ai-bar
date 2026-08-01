/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * textSearch.ts
 *
 * This file is part of Zotero AI Bar.
 */

export type GrepMatch = {
  line: number;
  excerpt: string;
  page?: number;
};

/**
 * Build a mapping from line number (0-based) to page number (1-based).
 * pageTexts is an array where each element is one page's text.
 * The concatenated text must be split the same way as the `text` param passed to grepInText.
 *
 * Kept for callers that only have pageTexts (no precomputed map). The hot path
 * (agentTools.grep) now passes a precomputed lineToPage from PageTextResult
 * instead, avoiding this re-split.
 */
export function buildLineToPageMap(lines: string[], pageTexts: string[]): Map<number, number> {
  const map = new Map<number, number>();
  let lineIdx = 0;
  for (let p = 0; p < pageTexts.length; p++) {
    const pageLineCount = pageTexts[p].split('\n').length;
    for (let j = 0; j < pageLineCount && lineIdx < lines.length; j++) {
      map.set(lineIdx, p + 1);
      lineIdx++;
    }
  }
  return map;
}

export type GrepInTextOptions = {
  /** Precomputed fullText.split('\n'); avoids re-splitting on every grep call. */
  lines?: string[];
  /** Precomputed 0-based line -> 1-based page map; avoids rebuilding per call. */
  lineToPage?: Map<number, number>;
};

export type GrepPage = {
  excerpts: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
  nextOffset?: number;
  remaining: number;
};

const MAX_GREP_RESULTS = 500;
const MAX_EXCERPT_CHARS = 2000;
const MAX_GREP_OUTPUT_CHARS = 250000;

export function grepInTextPaginated(
  text: string,
  pattern: string,
  useRegex: boolean,
  maxResults: number,
  offset: number,
  pageTexts?: string[],
  options?: GrepInTextOptions
): GrepPage {
  const safeMax = Math.max(1, Math.min(MAX_GREP_RESULTS, maxResults));
  const safeOffset = Math.max(0, Math.floor(offset));
  const lines = options?.lines ?? text.split('\n');
  const lineToPage = options?.lineToPage ?? (pageTexts ? buildLineToPageMap(lines, pageTexts) : undefined);
  const matches: GrepMatch[] = [];
  if (!pattern) return { excerpts: [], totalMatches: 0, truncated: false, remaining: 0 };

  let test: (line: string) => boolean;
  if (!useRegex) {
    const needle = pattern.toLowerCase();
    test = (line) => line.toLowerCase().includes(needle);
  } else {
    try {
      const regex = new RegExp(pattern, 'i');
      test = (line) => regex.test(line);
    } catch (error) {
      return {
        excerpts: [{ line: 0, excerpt: `Invalid pattern: ${String(error)}` }],
        totalMatches: 1,
        truncated: false,
        remaining: 0,
      };
    }
  }

  let totalMatches = 0;
  let outputChars = 0;
  for (let index = 0; index < lines.length; index++) {
    if (!test(lines[index])) continue;
    if (totalMatches >= safeOffset && matches.length < safeMax) {
      const excerpt = lines[index].trim().slice(0, MAX_EXCERPT_CHARS);
      if (outputChars + excerpt.length <= MAX_GREP_OUTPUT_CHARS) {
        matches.push({ line: index + 1, excerpt, page: lineToPage?.get(index) });
        outputChars += excerpt.length;
      }
    }
    totalMatches++;
  }
  const nextOffset = safeOffset + matches.length;
  const remaining = Math.max(0, totalMatches - nextOffset);
  return {
    excerpts: matches,
    totalMatches,
    truncated: remaining > 0,
    nextOffset: remaining > 0 ? nextOffset : undefined,
    remaining,
  };
}

/**
 * Search for a literal or regex pattern inside a text block.
 * Case-insensitive. Returns up to maxResults matches with 1-based line numbers.
 * pageTexts provides per-page text for page number resolution (ignored when
 * lineToPage is supplied via options).
 */
export function grepInText(
  text: string,
  pattern: string,
  useRegex: boolean,
  maxResults: number,
  pageTexts?: string[],
  options?: GrepInTextOptions
): GrepMatch[] {
  return grepInTextPaginated(text, pattern, useRegex, maxResults, 0, pageTexts, options).excerpts;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Kept for external callers/tests; grepInText no longer uses it internally now
// that the literal path lowercases instead of escaping. (Escape is still the
// correct semantics if a future caller builds a regex from a literal.)
export { escapeRegExp };
