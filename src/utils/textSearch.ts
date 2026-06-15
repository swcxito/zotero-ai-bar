/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * textSearch.ts
 *
 * This file is part of Zotero AI Bar.
 */

export type GrepMatch = {
  line: number;
  excerpt: string;
};

/**
 * Search for a literal or regex pattern inside a text block.
 * Case-insensitive. Returns up to maxResults matches with 1-based line numbers.
 */
export function grepInText(text: string, pattern: string, useRegex: boolean, maxResults: number): GrepMatch[] {
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
  const results: GrepMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      results.push({ line: i + 1, excerpt: lines[i].trim() });
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
