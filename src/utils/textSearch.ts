/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * textSearch.ts
 *
 * This file is part of Zotero AI Bar.
 */

export type GrepMatch = {
  line: number;
  excerpt: string;
  contextBefore?: string[];
  contextAfter?: string[];
};

/**
 * Search for a literal or regex pattern inside a text block.
 * Case-insensitive. Returns up to maxResults matches with 1-based line numbers.
 * contextLines controls how many surrounding lines to include before/after each match.
 */
export function grepInText(text: string, pattern: string, useRegex: boolean, maxResults: number, contextLines: number = 2): GrepMatch[] {
  const safeMax = Math.max(1, Math.min(50, maxResults));
  const safeCtx = Math.max(0, Math.min(10, contextLines));
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
      const contextBefore = safeCtx > 0 ? lines.slice(Math.max(0, i - safeCtx), i).map((l) => l.trim()) : undefined;
      const contextAfter = safeCtx > 0 ? lines.slice(i + 1, i + 1 + safeCtx).map((l) => l.trim()) : undefined;
      results.push({ line: i + 1, excerpt: lines[i].trim(), contextBefore, contextAfter });
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
