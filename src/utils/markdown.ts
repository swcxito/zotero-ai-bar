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

import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js";
import { markedXhtml } from "marked-xhtml";
import { getPref } from "./prefs";

marked.use(
  // 代码高亮扩展（必须在 KaTeX 之前）
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-", // 与 highlight.js 样式类匹配
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
  // 公式渲染扩展（自动处理 $...$ 和 $$...$$）
  markedKatex({
    throwOnError: false, // 公式错误时不中断渲染
    output: "mathml",
    nonStandard: true, // 支持非标准的公式
  }),
  markedXhtml(),
);
// 可选：自定义基础渲染选项
marked.setOptions({
  breaks: true, // 支持 GFM 换行
  gfm: true, // 启用 GitHub 风格 Markdown
  async: true,
});

/**
 * 优化公式格式：
 * 1. 在行内公式 $...$ 前后确保至少一个空格（如果不是行首/行尾）
 * 2. 在块级公式 $$...$$ 前后确保至少两个换行
 */
function optimizeFormulas(text: string): string {
  return text.replace(
    /(\s*)(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)(\s*)/g,
    (match, prefix, formula, suffix, offset) => {
      // 1. 处理块级公式
      if (formula.startsWith("$$")) {
        const newPrefix = offset === 0 ? "" : "\n\n";
        return newPrefix + formula + "\n\n";
      }

      // 2. 处理行内公式
      // 如果前缀为空且不是开头，添加空格
      const newPrefix = prefix || (offset === 0 ? "" : " ");
      // 如果后缀为空，添加空格
      const newSuffix = suffix || " ";

      return newPrefix + formula + newSuffix;
    },
  );
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
    if (getPref("chat.formulaOptimization")) {
      text = optimizeFormulas(text);
    }

    const html = await marked.parse(text);

    // 针对 Zotero 的 innerHTML 安全检查，补全 math 和 svg 的命名空间
    // 避免 "Removed unsafe attribute. Element: svg. Attribute: xmlns." 警告
    // 同时也确保在 XHTML 环境下这些标签能被正确识别
    return html
      .replace(
        /<math(?![^>]*xmlns)/g,
        '<math xmlns="http://www.w3.org/1998/Math/MathML"',
      )
      .replace(
        /<svg(?![^>]*xmlns)/g,
        '<svg xmlns="http://www.w3.org/2000/svg"',
      );
  } catch (error) {
    console.error("Markdown 解析失败:", error);
    return `<p class="error">内容解析错误</p>`;
  }
}
