import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js";
import { markedXhtml } from "marked-xhtml";

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
 * 将 Markdown 转为 HTML 字符串
 * @param markdown 源文本
 * @returns 渲染后的 HTML 字符串
 */
export function renderMarkdown(markdown: string): string | Promise<string> {
  try {
    return marked.parse(markdown);
  } catch (error) {
    console.error("Markdown 解析失败:", error);
    return `<p class="error">内容解析错误</p>`;
  }
}
