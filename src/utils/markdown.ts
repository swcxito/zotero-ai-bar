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
    nonStandard: true, // 支持非标准的单个 $ 行内公式
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
 * 1. 在单个 $ 符号前添加空格（如果缺失）
 * 2. 在 $$ 符号前确保有两个连续换行
 */
function optimizeFormulas(text: string): string {
  let optimized = text.replace(/(?<![ $])\$(?!\$)/g, (match, offset) => {
    // 如果 $ 处在字符串开头，不需要加空格
    return offset === 0 ? match : " " + match;
  });

  optimized = optimized.replace(/(\n*)\$\$/g, (match, newlines, offset) => {
    // 如果 $$ 处在字符串开头，直接返回
    // if (offset === 0) return "$$";
    return newlines.length < 2 ? "\n\n$$" : match;
  });

  return optimized;
}

/**
 * 将 Markdown 转为 HTML 字符串
 * @param markdown 源文本
 * @returns 渲染后的 HTML 字符串
 */
export function renderMarkdown(markdown: string): string | Promise<string> {
  try {
    let text = markdown;

    // 根据配置决定是否优化公式
    if (getPref("chat.formulaOptimization")) {
      text = optimizeFormulas(text);
    }

    return marked.parse(text);
  } catch (error) {
    console.error("Markdown 解析失败:", error);
    return `<p class="error">内容解析错误</p>`;
  }
}
