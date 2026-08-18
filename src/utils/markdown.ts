/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * markdown.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js';
import { markedXhtml } from 'marked-xhtml';
import { getPref } from './prefs';
import { getItemFullTextByPage } from './zoteroItemAccess';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ALLOWED_RAW_HTML_TAGS = ['sub'] as const;

/**
 * Cite marker body alternatives (the part after `[cite:` and before `]`):
 *  - `<itemId>[:<page>|L<line>[-<end>]][|<title>]`  item cite (cross-doc;
 *    line form resolves line->page at render time)
 *  - `p<page>[-<end>]`              page cite (current doc only)
 *  - `L<line>[-<end>]`              line cite (current doc only; resolves
 *    line->page at render time, renders like a page cite)
 *
 * The dash in ranges accepts `-`, `\u2013` (en-dash), `\u2014` (em-dash), or `~`.
 * Kept as a raw string so it can be embedded in larger regexes (e.g. the
 * wrapper-stripping patterns and the main marker regex).
 */
const CITE_BODY = String.raw`(?:\d+(?::(?:\d+|L\d+(?:(?:-|\u2013|\u2014|~)\s*\d+)?)?)?(?:\|[^\]]*)?|p\d+(?:(?:-|\u2013|\u2014|~)\s*\d+)?|L\d+(?:(?:-|\u2013|\u2014|~)\s*\d+)?)`;
const CITE_MARKER_RE = new RegExp(`\\[cite:(${CITE_BODY})\\]`, 'g');
/** Placeholder prefix used by `extractCiteMarkers` / `restoreCiteMarkers`. */
const CITE_PLACEHOLDER_PREFIX = 'ZAIBARCITE';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectAllowedHtmlPairs(text: string, allowedTags: readonly string[]): { text: string; tokenMap: Map<string, string> } {
  const tokenMap = new Map<string, string>();
  let withTokens = text;

  allowedTags.forEach((tag, index) => {
    const safeTag = escapeRegExp(tag);
    let pairIndex = 0;
    const pairPattern = new RegExp(`<${safeTag}>[\\s\\S]*?<\\/${safeTag}>`, 'gi');

    withTokens = withTokens.replace(pairPattern, (matched) => {
      const pairToken = `__ZAIBAR_ALLOW_TAG_${index}_PAIR_${pairIndex++}__`;
      tokenMap.set(pairToken, matched);
      return pairToken;
    });
  });

  return { text: withTokens, tokenMap };
}

marked.use(
  // 代码高亮扩展（必须在 KaTeX 之前）
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-', // 与 highlight.js 样式类匹配
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
  // 公式渲染扩展（自动处理 $...$ 和 $$...$$）
  markedKatex({
    throwOnError: false, // 公式错误时不中断渲染
    // Keep KaTeX's hidden MathML annotation. The selection-copy serializer
    // reads its application/x-tex payload to restore the original formula
    // instead of copying the many visual glyph spans as plain text.
    output: 'htmlAndMathml',
    nonStandard: true, // 支持非标准的公式
  }),
  markedXhtml()
);
// 可选：自定义基础渲染选项
marked.setOptions({
  breaks: true, // 支持 GFM 换行
  gfm: true, // 启用 GitHub 风格 Markdown
  async: true,
});

marked.use({
  renderer: {
    html(token: any) {
      const raw = typeof token === 'string' ? token : (token?.text ?? '');
      return escapeHtml(raw);
    },
  },
});

function optimizeFormulas(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];

  let inBlockMath = false;
  let blockQuotePrefix = '';

  for (const line of lines) {
    const delimiterMatch = line.match(/^(\s*(?:>\s*)*)\$\$\s*$/);

    if (delimiterMatch) {
      const prefix = delimiterMatch[1] ?? '';

      if (!inBlockMath) {
        inBlockMath = true;
        blockQuotePrefix = prefix;
        if (output.length > 0 && output[output.length - 1].trim() !== '') {
          output.push('');
        }
        output.push(`${blockQuotePrefix}$$`);
      } else {
        output.push(`${blockQuotePrefix}$$`);
        inBlockMath = false;
        blockQuotePrefix = '';
        output.push('');
      }

      continue;
    }

    if (inBlockMath) {
      const escapedPrefix = blockQuotePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const normalizedLine = blockQuotePrefix ? line.replace(new RegExp(`^\\s*${escapedPrefix}`), blockQuotePrefix) : line.replace(/^\s*/, '');
      output.push(normalizedLine);
      continue;
    }

    output.push(line);
  }

  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop();
  }

  return output.join('\n');
}

/**
 * 将 Markdown 转为 HTML 字符串
 * @param markdown 源文本
 * @returns 渲染后的 HTML 字符串
 */
export async function renderMarkdown(markdown: string, currentItemId?: number): Promise<string> {
  try {
    let text = markdown;

    // 根据配置决定是否优化公式
    if (getPref('chat.formulaOptimization')) {
      text = optimizeFormulas(text);
    }

    // Strip any markdown emphasis/link wrappers around citation markers.
    // The cite pill / header has its own styling, so wrappers like
    // **[cite:..]**, *[cite:..]*, _[cite:..]_, [text](cite-url) that the LLM
    // sometimes adds are unwanted noise. We unwrap them BEFORE marked.parse
    // so the emphasis HTML is never generated.
    text = stripCitationWrappers(text);

    // Extract cite markers into alphanumeric placeholders BEFORE marked.parse.
    // This prevents the `|` in [cite:id|title] from being interpreted as a GFM
    // table cell separator (which splits the marker and breaks rendering).
    const { text: textWithPlaceholders, citeTokens } = extractCiteMarkers(text);

    const { text: protectedText, tokenMap } = protectAllowedHtmlPairs(textWithPlaceholders, ALLOWED_RAW_HTML_TAGS);

    let html = await marked.parse(protectedText);

    tokenMap.forEach((value, token) => {
      html = html.replaceAll(token, value);
    });

    // 针对 Zotero 的 innerHTML 安全检查，补全 math 和 svg 的命名空间
    // 避免 "Removed unsafe attribute. Element: svg. Attribute: xmlns." 警告
    // 同时也确保在 XHTML 环境下这些标签能被正确识别
    html = html
      .replace(/<math(?![^>]*xmlns)/g, '<math xmlns="http://www.w3.org/1998/Math/MathML"')
      .replace(/<svg(?![^>]*xmlns)/g, '<svg xmlns="http://www.w3.org/2000/svg"');

    // Restore cite markers from placeholders and render as HTML.
    // Two passes:
    //  1. A placeholder that is the sole content of a <p> (i.e. the marker was
    //     on its own line in the source markdown) becomes a block-level
    //     "citation header". Only item cites (not page/line cites) get this.
    //  2. Remaining placeholders become inline pill spans.
    // Both element types carry the same `zaibar-cite` class + data attributes
    // so the click + tooltip handlers in chatUI.ts treat them uniformly.
    html = await restoreCiteMarkers(html, citeTokens, currentItemId);

    return html;
  } catch (error) {
    console.error('Markdown 解析失败:', error);
    return `<p class="error">内容解析错误</p>`;
  }
}

const CITE_TITLE_MAX = 40;

function resolveCitationItem(itemId: number): Zotero.Item | null {
  try {
    return Zotero.Items.get(itemId) ?? null;
  } catch {
    return null;
  }
}

/**
 * If `item` is a file attachment, return its parent (the regular item that
 * carries title / creators / publication metadata). Otherwise return `item`
 * itself. Falls back to `item` if the parent is missing.
 */
function resolveMetadataItem(item: Zotero.Item): Zotero.Item {
  try {
    if (item.isAttachment?.()) {
      const parentID = (item as any).parentItemID ?? (item as any).parentID;
      if (parentID) {
        const parent = Zotero.Items.get(parentID);
        if (parent) return parent;
      }
    }
  } catch {
    // ignore
  }
  return item;
}

function truncateTitle(title: string): string {
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= CITE_TITLE_MAX) return trimmed;
  return trimmed.slice(0, CITE_TITLE_MAX - 1).trimEnd() + '…';
}

/**
 * Remove markdown emphasis or link wrappers that surround a citation marker.
 * Run before `marked.parse` so the wrapper HTML is never produced.
 *
 * Handles:
 *  - **[cite:..]**   ->  [cite:..]   (bold)
 *  - __[cite:..]__   ->  [cite:..]   (bold alt)
 *  - *[cite:..]*     ->  [cite:..]   (italic)
 *  - _[cite:..]_     ->  [cite:..]   (italic alt)
 *  - ~~[cite:..]~~   ->  [cite:..]   (strikethrough)
 *  - `[cite:..]`     ->  [cite:..]   (inline code — defeats the marker)
 *  - [[cite:..]](url)->  [cite:..]   (markdown link wrapping the marker)
 */
function stripCitationWrappers(text: string): string {
  let prev: string;
  let cur = text;
  cur = cur.replace(new RegExp(String.raw`\[(\[cite:${CITE_BODY}\])\]\([^)]*\)`, 'g'), '$1');
  cur = cur.replace(new RegExp('`' + String.raw`(\[cite:${CITE_BODY}\])` + '`', 'g'), '$1');
  do {
    prev = cur;
    cur = cur
      .replace(new RegExp(String.raw`\*\*\s*(\[cite:${CITE_BODY}\])\s*\*\*`, 'g'), '$1')
      .replace(new RegExp(String.raw`__\s*(\[cite:${CITE_BODY}\])\s*__`, 'g'), '$1')
      .replace(new RegExp(String.raw`~~\s*(\[cite:${CITE_BODY}\])\s*~~`, 'g'), '$1')
      .replace(new RegExp(String.raw`(?<![*_])\*\s*(\[cite:${CITE_BODY}\])\s*\*(?![*_])`, 'g'), '$1')
      .replace(new RegExp(String.raw`(?<![*_])_\s*(\[cite:${CITE_BODY}\])\s*_(?![*_])`, 'g'), '$1');
  } while (cur !== prev);
  return cur;
}

function buildCitationLabel(itemId: number, page?: number, truncate = true): string {
  const item = resolveCitationItem(itemId);
  if (!item) return `#${itemId}`;
  const meta = resolveMetadataItem(item);
  const title = (meta.getField?.('title') as string | undefined)?.trim();
  let label = title ? (truncate ? truncateTitle(title) : title) : `#${itemId}`;
  if (page && page > 0) label += ` · p.${page}`;
  return label;
}

/**
 * Replace every `[cite:...]` marker in `text` with an alphanumeric placeholder
 * (`ZAIBARCITE000000`, zero-padded 6-digit index). The placeholders survive
 * `marked.parse` untouched and - crucially - contain no `|`, so they no longer
 * split GFM table cells the way the raw `[cite:id|title]` marker did.
 *
 * The original marker bodies are returned in `citeTokens` (indexed by the
 * placeholder number) so `restoreCiteMarkers` can render them to HTML after
 * the markdown parse.
 */
function extractCiteMarkers(text: string): { text: string; citeTokens: string[] } {
  const citeTokens: string[] = [];
  const replaced = text.replace(CITE_MARKER_RE, (_m, body: string) => {
    const idx = citeTokens.length;
    citeTokens.push(body);
    return `${CITE_PLACEHOLDER_PREFIX}${String(idx).padStart(6, '0')}`;
  });
  return { text: replaced, citeTokens };
}

/**
 * Render a single cite marker body (the part between `[cite:` and `]`) to its
 * final HTML string. Returns `null` if the body matches no known form.
 *
 * `asHeader=true` produces the block-level `<div class="zaibar-cite-header">`
 * used when the marker sat alone on its own line; only item cites use this -
 * page cites always render as inline pills regardless of `asHeader`.
 *
 * `linePageMap` maps `"${itemId}:${line}"` -> resolved 1-based page number for
 * cross-document line cites (`[cite:<itemId>:L<line>]`). When a page is
 * resolved, the cite renders identically to a normal item+page cite (label
 * shows "Title · p.X", `data-page` is set for click/tooltip). When resolution
 * fails, `data-line` is set as a fallback so the click handler can try again
 * on click, and the tooltip shows "L.<line>".
 */
function renderCiteBody(
  body: string,
  currentItemId: number | undefined,
  asHeader: boolean,
  linePageMap?: Map<string, number | undefined>
): string | null {
  // Item cite: <itemId>[:<page>|L<line>[-<end>]][|<title>]
  const itemMatch = body.match(/^(\d+)(?::([^|]+))?(?:\|.*)?$/);
  if (itemMatch) {
    const itemId = parseInt(itemMatch[1], 10);
    const slot = itemMatch[2]; // "5", "L42", "L42-58", or undefined

    let page: number | undefined;
    let line: number | undefined;
    let lineRange: string | undefined;

    if (slot && slot.startsWith('L')) {
      // Cross-document line cite: resolve line -> page at render time.
      const lineMatch = slot.match(/^L(\d+)\s*(?:(?:-|\u2013|\u2014|~)\s*(\d+))?$/);
      if (lineMatch) {
        line = parseInt(lineMatch[1], 10);
        const endStr = lineMatch[2];
        if (endStr) {
          const end = parseInt(endStr, 10);
          if (Number.isFinite(end) && end >= line) lineRange = `${line}-${end}`;
        }
        page = linePageMap?.get(`${itemId}:${line}`);
      }
    } else if (slot) {
      page = parseInt(slot, 10);
      if (!Number.isFinite(page)) page = undefined;
    }

    // When page is resolved, emit data-page (click/tooltip use it directly).
    // When only line is known (resolution failed), emit data-line as fallback.
    const pageAttr = page !== undefined ? ` data-page="${page}"` : '';
    const lineAttr = line !== undefined && page === undefined ? ` data-line="${line}"` : '';
    const lineRangeAttr = lineRange && page === undefined ? ` data-line-range="${lineRange}"` : '';

    if (asHeader) {
      const label = buildCitationLabel(itemId, page, false);
      return `<div class="zaibar-cite zaibar-cite-header" data-item-id="${itemId}"${pageAttr}${lineAttr}${lineRangeAttr}>${escapeHtml(label)}</div>`;
    }
    const label = buildCitationLabel(itemId, page);
    return `<span class="zaibar-cite" data-item-id="${itemId}"${pageAttr}${lineAttr}${lineRangeAttr}>${escapeHtml(label)}</span>`;
  }

  // Page cite: p<page>[-<end>]  (current document only)
  const pageMatch = body.match(/^p(\d+)\s*(?:(?:-|\u2013|\u2014|~)\s*(\d+))?$/);
  if (pageMatch) {
    const start = parseInt(pageMatch[1], 10);
    const endStr = pageMatch[2];
    const end = endStr ? parseInt(endStr, 10) : NaN;
    const isRange = Number.isFinite(end) && end >= start;
    const rangeText = isRange ? `${start}-${end}` : '';
    const idAttr = Number.isFinite(currentItemId) ? ` data-item-id="${currentItemId}"` : '';
    const rangeAttr = isRange ? ` data-page-range="${rangeText}"` : '';
    const label = isRange ? `p.${start}-${end}` : `p.${start}`;
    return `<span class="zaibar-cite"${idAttr} data-page="${start}"${rangeAttr}>${label}</span>`;
  }

  // Line cite (current document only): L<line>[-<end>].
  // Resolve line -> page at render time and render like a page cite ("p.X").
  // Only the first line's page is resolved (consistent with cross-doc line
  // cites); the end line is dropped from the resolved label. Falls back to
  // "L.X" with data-line (click handler resolves on click) when the
  // lineToPage map is unavailable.
  const lineMatch = body.match(/^L(\d+)\s*(?:(?:-|\u2013|\u2014|~)\s*(\d+))?$/);
  if (lineMatch) {
    const start = parseInt(lineMatch[1], 10);
    const endStr = lineMatch[2];
    const end = endStr ? parseInt(endStr, 10) : NaN;
    const isRange = Number.isFinite(end) && end >= start;
    const lineRangeText = isRange ? `${start}-${end}` : '';
    const idAttr = Number.isFinite(currentItemId) ? ` data-item-id="${currentItemId}"` : '';
    const page = Number.isFinite(currentItemId) ? linePageMap?.get(`${currentItemId}:${start}`) : undefined;
    if (page !== undefined) {
      // Resolved: render as a page pill (consistent with [cite:p<page>]).
      const label = `p.${page}`;
      return `<span class="zaibar-cite"${idAttr} data-page="${page}">${label}</span>`;
    }
    // Unresolved: show line label, click handler resolves on click.
    const lineRangeAttr = isRange ? ` data-line-range="${lineRangeText}"` : '';
    const label = isRange ? `L.${start}-${end}` : `L.${start}`;
    return `<span class="zaibar-cite"${idAttr} data-line="${start}"${lineRangeAttr}>${label}</span>`;
  }

  return null;
}

/**
 * Pre-resolve all line cites in `citeTokens` to their 1-based PDF page numbers.
 *
 * Two forms are supported:
 *  - Cross-document: `<itemId>:L<line>` -> resolved via that item's lineToPage.
 *  - Current document: `L<line>` -> resolved via `currentItemId`'s lineToPage.
 *
 * Items are batched so each distinct itemId's `lineToPage` map is fetched only
 * once (via `getItemFullTextByPage`, which reads Zotero's indexed full-text
 * cache file - fast, no PDF re-parse).
 *
 * Returns a `Map<string, number | undefined>` keyed by `"${itemId}:${line}"`.
 */
async function resolveLineCites(citeTokens: string[], currentItemId?: number): Promise<Map<string, number | undefined>> {
  const result = new Map<string, number | undefined>();
  // Collect unique (itemId, line) pairs from line cite bodies.
  const itemLines = new Map<number, Set<number>>();
  for (const body of citeTokens) {
    let itemId: number | undefined;
    let line: number | undefined;
    // Cross-document: <itemId>:L<line>
    const cross = body.match(/^(\d+):L(\d+)/);
    if (cross) {
      itemId = parseInt(cross[1], 10);
      line = parseInt(cross[2], 10);
    } else {
      // Current document: L<line> (needs currentItemId)
      const cur = body.match(/^L(\d+)/);
      if (cur && Number.isFinite(currentItemId)) {
        itemId = currentItemId;
        line = parseInt(cur[1], 10);
      }
    }
    if (itemId !== undefined && line !== undefined) {
      if (!itemLines.has(itemId)) itemLines.set(itemId, new Set());
      itemLines.get(itemId)!.add(line);
    }
  }
  // Fetch each item's lineToPage map once, resolve all its lines.
  for (const [itemId, lines] of itemLines) {
    let pageResult;
    try {
      pageResult = await getItemFullTextByPage(itemId);
    } catch {
      pageResult = undefined;
    }
    for (const line of lines) {
      // lineToPage maps 0-based line index -> 1-based page number.
      result.set(`${itemId}:${line}`, pageResult?.lineToPage.get(line - 1));
    }
  }
  return result;
}

/**
 * Replace `ZAIBARCITE000000` placeholders in the parsed HTML with their final
 * cite HTML. Two passes:
 *  1. A placeholder that is the sole content of a `<p>` (i.e. the marker was
 *     on its own line) becomes a block-level "citation header" `<div>`. Only
 *     item cites become headers; page cites are left for the inline pass
 *     (their `<p>` wrapper is restored so they stay in normal paragraph flow).
 *  2. All remaining placeholders become inline pill `<span>`s.
 *
 * Async because line cites (`[cite:L<line>]` current-doc and
 * `[cite:<itemId>:L<line>]` cross-doc) require a `lineToPage` lookup to
 * resolve the line to a page before rendering.
 */
async function restoreCiteMarkers(html: string, citeTokens: string[], currentItemId?: number): Promise<string> {
  const linePageMap = await resolveLineCites(citeTokens, currentItemId);
  const placeholderRe = new RegExp(`${CITE_PLACEHOLDER_PREFIX}(\\d{6})`, 'g');
  const headerRe = new RegExp(`<p>\\s*(${CITE_PLACEHOLDER_PREFIX}\\d{6})\\s*</p>`, 'g');

  // Pass 1: block-level header (item cites only).
  html = html.replace(headerRe, (m, token: string) => {
    const idx = parseInt(token.slice(CITE_PLACEHOLDER_PREFIX.length), 10);
    const body = citeTokens[idx];
    const rendered = renderCiteBody(body, currentItemId, true, linePageMap);
    // Not an item cite - keep the placeholder (wrapped back in <p>) for the
    // inline pass so page cites stay in paragraph flow.
    return rendered ?? `<p>${token}</p>`;
  });

  // Pass 2: inline pill spans for everything else.
  html = html.replace(placeholderRe, (m, numStr: string) => {
    const idx = parseInt(numStr, 10);
    const body = citeTokens[idx];
    const rendered = renderCiteBody(body, currentItemId, false, linePageMap);
    return rendered ?? m;
  });

  return html;
}
