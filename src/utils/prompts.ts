/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * prompts.ts
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
import { FluentMessageId } from '../../typings/i10n';
import { Icons } from '../components/common';

export const SYSTEM_PROMPT_PREFIX = `# Role
You are an intelligent and professional research assistant embedded in Zotero. Your goal is to assist researchers by analyzing document fragments.

# Task
Answer user queries based on the provided document content. The specific user selection is wrapped in <selected>...</selected> tags. The text surrounding these tags is context.

# Constraints
1. **Scope:** Process ONLY the content inside <selected>...</selected>. Use the surrounding text ONLY for context (e.g., to determine disambiguation or part of speech). When quoting the selection, use natural language like "the text you selected" instead of the <selected> tags. DO NOT include the <selected> tags in your response.
2. **Accuracy:** Do not hallucinate or make up facts not present in the source.
3. **No Conversational Filler:** Do not output "Here is the translation" or "Sure". Go straight to the answer.
4. **Formatting:**
  - Use Markdown. Follow the **GFM specification** strictly.
  - Do NOT use HTML tags.
  - Use appropriate Markdown elements to enhance readability.
  - Inline code (\`...\`) can be used as highlighting if necessary, but do not abuse it.
5. **Formula**:
  - Notice: Long formulas such as continued equality must be output in block format. Formulas should never be wrapped in Markdown bold blocks nor tables.
  - Inline math: $ E=mc^2 $ (space before/after).
  - Block math:

    $$
    E=mc^2
    $$

    (empty lines before/after).`;

export interface AIBarCommand {
  id: string;
  icon: string;
  label: FluentMessageId;
  getPrompt: (targetLanguage: string) => string;
}

export function getAutoImagePrompt(outputLanguage: string): string {
  const lang = outputLanguage || '';
  return `核心任务：
请仔细观察我上传的论文图片，并结合已提供的论文元数据、选中文本、页内/附近文字或正文引用，为我提供一份逻辑清晰、结构化的图表深度解析。

上下文使用要求：
- 优先识别图片中的标题、图号、子图标签、坐标轴、图例、注释和表格文字。
- 如果上下文中包含图题、图注、当前页文字、正文对该图的引用或相关段落，请用它们校准解释，不要只凭视觉内容猜测。
- 如果图片与上下文存在冲突，明确区分“图中可见信息”和“上下文说明”。
- 对无法辨认或上下文不足的内容，请标注“不确定”或“推测”，不要编造精确数值、实验条件或结论。

输出结构要求：
请严格按照以下四个维度进行输出：

1. 图片概览与类型 (Overview)
这是一张什么类型的图表？（如：生存曲线图、荧光染色图、神经网络架构图）
它对应的图号/子图编号是什么？如果能从图题、图注或上下文判断，请说明这张图在论文中要回答的核心问题。

2. 视觉元素与变量解析 (Variables & Elements)
坐标轴：如果是数据图，明确指出 X 轴和 Y 轴分别代表什么变量及其单位。
图例与标记：解释不同颜色、形状、线条（实线/虚线）代表的实验组、对照组或特定条件。
统计学意义：指出图中是否有误差线（Error bars）、P 值标记（如 * 或 **）或其他统计显著性标志，并解释其含义。
上下文补充：结合图题、图注或正文附近文字补充实验对象、方法、条件和指标含义。

3. 核心数据与趋势发现 (Key Findings)
不要只是罗列数据，请描述关键趋势、差异或相关性（例如：“A 组随着浓度增加呈现显著下降趋势，而 B 组保持平稳”）。
指出图中的极值、拐点或异常数据（如果有）。
如上下文给出了作者对该图的解释，请说明它如何支持或限定你的视觉判断。

4. 科学结论与价值 (Conclusion & Takeaways)
基于图片可见证据和上下文信息，作者想通过这张图得出什么科学结论？
这个结论如何支撑该研究？还存在哪些仅凭当前图片无法确认的限制？

额外约束：
请使用准确、专业的学术术语。
如果图中的某些文字过于模糊无法辨认，请结合上下文给出合理的推测，并注明“推测”字样。
排版清晰，合理使用 Markdown 语法，方便阅读。
如果有多张图片，请依次解释，并在每张图中分别说明可见信息、上下文信息和不确定点。

输出语言要求：请用${lang || '中文'}输出。
`;
}

export const aiBarCommands: Record<string, AIBarCommand> = {
  explain: {
    id: 'explain',
    icon: Icons.Book,
    label: 'reader-bar-explain',
    getPrompt: (targetLanguage: string) =>
      `${targetLanguage ? `\n**IMPORTANT: You must output your entire explanation in ${targetLanguage}.**\n` : ''}
### Analysis Strategy
Please analyze the <selected> text and choose the most appropriate explanation strategy below:

1. **If the selection is an isolated concept, jargon, or term:**
   - Define WHAT it is clearly and directly.
   - Explain it in a way that a beginner can fully understand without any prior domain knowledge.

2. **If the selection makes a conclusion, claim, or deduction:**
   - Explain HOW and WHY this conclusion is reached.
   - Break down the logic or reasoning process step-by-step.
   - Insert necessary background knowledge or premises using Markdown blockquotes (\`>\`) to make the analysis easier to follow.

3. **If the selection is general text (sentences/paragraphs):**
   - Paraphrase the core meaning of the <selected> text.
   - Analyze its implications and clarify any complex phrasing based on its apparent context.

### Constraints & Formatting
- **Tone & Style:** Use precise, professional, and objective language. Avoid overly abstract metaphors.
- **Completeness:** Utilize your broad knowledge to provide a deep understanding, but keep the context relevant.
- **Structure:** Strictly use Markdown formatting. Use appropriate headings (\`#\`), bullet points (\`-\`), ordered lists (\`1.\`, \`2.\`), and bold text (\`**text**\`) to ensure the explanation is highly scannable and readable.
- **Context:** Briefly explain the surrounding context if it is essential for understanding the selection.
`,
  },
  summarize: {
    id: 'summarize',
    icon: Icons.Summary,
    label: 'reader-bar-summarize',
    getPrompt: (targetLanguage: string) =>
      `Summarize the <selected> text concisely${targetLanguage ? ` in ${targetLanguage}` : ''}, highlighting the key points.`,
  },
  translate: {
    id: 'translate',
    icon: Icons.Translate,
    label: 'reader-bar-translate',
    getPrompt: (targetLanguage: string) => `
# Task
Translate the <selected> content into ${targetLanguage}.

# Mode Selection Rules
Before response, Analyze the type of <selected> text and follow the matching rule below:

## Mode 1: Sentence or Paragraph
IF the selection is a phrase, sentence, or paragraph:
- Provide a direct, fluent, and academic translation.
- Do not add explanations nor original text.

## Mode 2: Abbreviation / Acronym (e.g., NASA, AI, RNA)
IF the selection is an abbreviation:
- Format: **Abbreviation**
- Line 1: Full form in English.
- Line 2: abbr. + Full form in ${targetLanguage}.
- Line 3: Brief explanation in ${targetLanguage}.

## Mode 3: Single Word
IF the selection is a single word:
- Analyze the surrounding context to determine the specific meaning used here.
- Output strictly using this format:

**<Word>**
\`<IPA Pronunciation>\`
**<Part of Speech>. <Meaning in CURRENT Context>**
-----
<Part of Speech>. <Other Common Meaning 1>
<Part of Speech>. <Other Common Meaning 2>

# Examples
It is an example of how to format your response based on the selection type.
The following examples using English to Chinese translation are for illustration only, please translate into ${targetLanguage} in your response.
## Example (Word):
Context: Work adopted a <selected>single</selected> green micro-LED.
Output:
**single**
\`/ˈsɪŋɡ(ə)l/\`
**adj. 单一的,单个的**
-----
adj. 独自的;单身的
n. 单曲

## Example (Abbreviation):
Context: Research by <selected>NASA</selected> shows...
Output:
**NASA**
\`National Aeronautics and Space Administration\`
abbr. 美国国家航空航天局
负责民用太空计划、航空研究和太空研究的机构

## Example (Sentence or Paragraph):
Context: <selected>The results were inconclusive.</selected>
Output:
结果是非决定性的。

## Example (Sentence or Paragraph):
Context: <selected>Photosynthesis is the process by which green plants and some other organisms use sunlight to synthesize foods from carbon dioxide and water.</selected>
Output:
光合作用是绿色植物和其他一些生物利用阳光将二氧化碳和水合成食物的过程。
`,
  },
  smartCopy: {
    id: 'smartCopy',
    icon: Icons.SmartCopy,
    label: 'reader-bar-smart-copy',
    getPrompt: () => `
# Task
Clean and format the <selected> text, preserving the original language while removing noise and formatting formulas.

# Critical Requirements

## 1. Language Preservation (MANDATORY)
- **CRITICAL**: Output MUST be in the SAME LANGUAGE as the input <selected> text.
- Do NOT translate the content under any circumstances.
- Maintain all original terms, names, and technical vocabulary in their original language.
- Preserve original punctuation and writing style of the source language.

## 2. Preserve Content Structure
- Keep original text structure, wording, and paragraph breaks.
- Do NOT paraphrase, summarize, or add commentary.
- Maintain academic tone and technical terminology.

## 3. Remove Document Artifacts
Remove common PDF/document noise:
- Page numbers (e.g., "Page 5", "- 23 -")
- Headers and footers (repeated text at top/bottom)
- Column formatting artifacts (broken words, unnatural line breaks)
- Watermarks and metadata
- Reference markers that break flow (keep inline citations if part of sentence)

## 4. Formula Formatting
Convert mathematical expressions to LaTeX Markdown:

**Inline formulas**: \` $ formula $ \` (spaces around)
Example: The energy $ E = mc^2 $ shows...

**Block formulas**:

$$
formula
$$

(empty lines before/after)

**Recognition patterns:**
- Greek: α, β, γ, Δ, Σ, θ, λ, μ, π, σ, ω
- Operators: ±, ×, ÷, ≈, ≠, ≤, ≥, ∈, ∉, ∑, ∏, ∫, ∂
- Symbols: √, ∞, →, ⇒, ∀, ∃
- Sub/superscripts: x₁, x², eⁿ

# Example

Input:
\`\`\`
--- Page 42 ---
The relationship between energy and mass is given by Einstein's
famous equation E=mc². This fundamental principle
————————————————————
Journal of Physics | Volume 23
————————————————————
shows that energy E and mass m are interchangeable.
\`\`\`

Output:
\`\`\`
The relationship between energy and mass is given by Einstein's famous equation $ E = mc^2 $. This fundamental principle shows that energy $ E $ and mass $ m $ are interchangeable.
\`\`\`
`,
  },
};
