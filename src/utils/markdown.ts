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
    // nonStandard: true, // 支持非标准的单个 $ 行内公式
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
