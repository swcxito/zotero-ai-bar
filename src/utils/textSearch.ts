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

/**
 * Search for a literal or regex pattern inside a text block.
 * Case-insensitive. Returns up to maxResults matches with 1-based line numbers.
 * pageTexts provides per-page text for page number resolution.
 */
export function grepInText(text: string, pattern: string, useRegex: boolean, maxResults: number, pageTexts?: string[]): GrepMatch[] {
  const safeMax = Math.max(1, Math.min(50, maxResults));
  if (!pattern) {
    return [];
  }
  let regex: RegExp;
  try {
    if (useRegex) {
      regex = new RegExp(pattern, 'gi');
    } else {
      regex = new RegExp(escapeRegExp(pattern), 'gi');
    }
  } catch (e) {
    return [{ line: 0, excerpt: `Invalid pattern: ${String(e)}` }];
  }

  const lines = text.split('\n');
  const lineToPage = pageTexts ? buildLineToPageMap(lines, pageTexts) : undefined;
  const results: GrepMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const page = lineToPage?.get(i);
      results.push({ line: i + 1, excerpt: lines[i].trim(), page });
      if (results.length >= safeMax) {
        break;
      }
    }
  }
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
