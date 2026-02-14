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
import { FluentMessageId } from "../../typings/i10n";

export const SYSTEM_PROMPT_PREFIX = `# Role
You are an intelligent research assistant embedded in Zotero. Your goal is to assist researchers by analyzing document fragments.

# Task
Answer user queries based on the provided document content. The specific user selection is wrapped in <selected>...</selected> tags. The text surrounding these tags is context.

# Constraints
1. **Scope:** Process ONLY the content inside <selected>...</selected>. Use the surrounding text ONLY for context (e.g., to determine disambiguation or part of speech).
2. **Accuracy:** Do not hallucinate or make up facts not present in the source.
3. **No Conversational Filler:** Do not output "Here is the translation" or "Sure". Go straight to the answer.
4. **Formatting:** - Use Markdown.
5. **Formula**:
  - Inline math: $ E=mc^2 $ (space before/after).
  - Block math:
<Empty line here>
    $$
    E=mc^2
    $$
<Empty line here>
    (empty lines before/after).

# Content`;

export interface AIBarCommand {
    id: string;
    icon: string;
    label: FluentMessageId;
    getPrompt: (targetLanguage: string) => string;
}

export const aiBarCommands: Record<string, AIBarCommand> = {
    explain: {
        id: "explain",
        icon: "📖",
        label: "reader-bar-explain",
        getPrompt: (targetLanguage: string) => `Explain the <selected> text detailed in the document. ${targetLanguage ? `Answer in ${targetLanguage}.` : ""}`,
    },
    summarize: {
        id: "summarize",
        icon: "📝",
        label: "reader-bar-summarize",
        getPrompt: (targetLanguage: string) =>
            `Summarize the <selected> text concisely${targetLanguage ? ` in ${targetLanguage}` : ""}, highlighting the key points.`,
    },
    translate: {
        id: "translate",
        icon: "🌐",
        label: "reader-bar-translate",
        getPrompt: (targetLanguage: string) => `
# Task
Translate the <selected> content into ${targetLanguage}.

# Mode Selection Rules
Analyze the <selected> text and follow the matching rule below:

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
<IPA Pronunciation>
**<Part of Speech>. <Meaning in CURRENT Context>**
-----
<Part of Speech>. <Other Common Meaning 1>
<Part of Speech>. <Other Common Meaning 2>

# Examples
It is a example of how to format your response based on the selection type.
The following examples using English to Chinese translation are for illustration only, please translate into ${targetLanguage} in your response.
## Example (Word):
Context: Work adopted a <selected>single</selected> green micro-LED.
Output:
**single**
/ˈsɪŋɡ(ə)l/
**adj. 单一的，单个的**
-----
adj. 独自的；单身的
n. 单曲

## Example (Abbreviation):
Context: Research by <selected>NASA</selected> shows...
Output:
**NASA**
National Aeronautics and Space Administration
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
};
