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

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ALLOWED_RAW_HTML_TAGS = ['sub'] as const;

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
    output: 'html',
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
export async function renderMarkdown(markdown: string): Promise<string> {
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

    const { text: protectedText, tokenMap } = protectAllowedHtmlPairs(text, ALLOWED_RAW_HTML_TAGS);

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

    // Render citation markers [cite:itemId[:page][|title]].
    // The title segment (after |) is accepted but IGNORED at render time —
    // the UI always resolves the title from the Zotero item cache so it stays
    // authoritative and never drifts from what the model wrote. We accept it
    // purely as a "slot" so the model can satisfy its urge to include the
    // title inside the marker rather than repeating it in the prose.
    //
    // Two passes:
    //  1. A marker that is the sole content of a <p> (i.e. on its own line in
    //     the source markdown) becomes a block-level "citation header". Title
    //     is shown full (not truncated) and wraps.
    //  2. Inline markers become pill spans (truncated).
    // Both element types carry the same `zaibar-cite` class + data attributes
    // so the click + tooltip handlers in chatUI.ts treat them uniformly.
    const citeRe = /\[cite:(\d+)(?::(\d+))?(?:\|[^\]]*)?\]/g;
    html = html.replace(/<p>\s*\[cite:(\d+)(?::(\d+))?(?:\|[^\]]*)?\]\s*<\/p>/g, (_m, idStr, pageStr) => {
      const itemId = parseInt(idStr, 10);
      const page = pageStr ? parseInt(pageStr, 10) : NaN;
      const label = buildCitationLabel(itemId, Number.isFinite(page) ? page : undefined, false);
      const pageAttr = Number.isFinite(page) ? ` data-page="${page}"` : '';
      return `<div class="zaibar-cite zaibar-cite-header" data-item-id="${itemId}"${pageAttr}>${escapeHtml(label)}</div>`;
    });
    html = html.replace(citeRe, (_match, idStr, pageStr) => {
      const itemId = parseInt(idStr, 10);
      const page = pageStr ? parseInt(pageStr, 10) : NaN;
      const label = buildCitationLabel(itemId, Number.isFinite(page) ? page : undefined);
      const pageAttr = Number.isFinite(page) ? ` data-page="${page}"` : '';
      return `<span class="zaibar-cite" data-item-id="${itemId}"${pageAttr}>${escapeHtml(label)}</span>`;
    });

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
  cur = cur.replace(/\[(\[cite:\d+(?::\d+)?(?:\|[^\]]*)?\])\]\([^)]*\)/g, '$1');
  cur = cur.replace(/`(\[cite:\d+(?::\d+)?(?:\|[^\]]*)?\])`/g, '$1');
  do {
    prev = cur;
    cur = cur
      .replace(/\*\*\s*(\[cite:\d+(?::\d+)?(?:\|[^\]]*)?\])\s*\*\*/g, '$1')
      .replace(/__\s*(\[cite:\d+(?::\d+)?(?:\|[^\]]*)?\])\s*__/g, '$1')
      .replace(/~~\s*(\[cite:\d+(?::\d+)?(?:\|[^\]]*)?\])\s*~~/g, '$1')
      .replace(/(?<![*_])\*\s*(\[cite:\d+(?::\d+)?(?:\|[^\]]*)?\])\s*\*(?![*_])/g, '$1')
      .replace(/(?<![*_])_\s*(\[cite:\d+(?::\d+)?(?:\|[^\]]*)?\])\s*_(?![*_])/g, '$1');
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
