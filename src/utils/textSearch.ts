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
  const safeMax = Math.max(1, Math.min(50, maxResults));
  if (!pattern) {
    return [];
  }

  // Literal fast path: lowercase substring scan, no regex engine.
  // useRegex===false means pattern is a plain literal; case-insensitivity is
  // handled by lowercasing both sides.
  const lines = options?.lines ?? text.split('\n');
  const lineToPage = options?.lineToPage ?? (pageTexts ? buildLineToPageMap(lines, pageTexts) : undefined);

  const results: GrepMatch[] = [];
  if (!useRegex) {
    const needle = pattern.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        results.push({ line: i + 1, excerpt: lines[i].trim(), page: lineToPage?.get(i) });
        if (results.length >= safeMax) break;
      }
    }
    return results;
  }

  // Regex path. Note: we use the 'i' flag WITHOUT 'g'. A previous version used
  // 'gi' and called regex.test() per line - but 'g' makes test() stateful
  // (lastIndex carries across lines), which silently skipped matches on
  // consecutive identical matching lines. We only need "does this line match",
  // so a stateless case-insensitive test is correct and faster.
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch (e) {
    return [{ line: 0, excerpt: `Invalid pattern: ${String(e)}` }];
  }

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      results.push({ line: i + 1, excerpt: lines[i].trim(), page: lineToPage?.get(i) });
      if (results.length >= safeMax) break;
    }
  }
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Kept for external callers/tests; grepInText no longer uses it internally now
// that the literal path lowercases instead of escaping. (Escape is still the
// correct semantics if a future caller builds a regex from a literal.)
export { escapeRegExp };
