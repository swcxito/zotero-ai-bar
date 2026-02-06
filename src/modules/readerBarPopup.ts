/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * readerBarPopup.ts
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

import { config } from "../../package.json";
import { getSelectionContext } from "./selectionContext";
import { streamLLM } from "../utils/llmRequest";
import { SYSTEM_PROMPT_PREFIX } from "../constants";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

//TODO: DOM 操作: 手动创建 ripple 效果的代码稍显冗余，可以考虑封装成一个通用指令或 CSS 动画。

// Generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// must call once in mainwindow otherwise css file won't be loaded in reader popup
export function registerAIBarStyleSheet(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const styles = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css`,
    },
  });
  doc.documentElement?.appendChild(styles);
}

export function registerReaderInitializer() {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    ({ reader, doc, params, append }) => {
      // addon.hooks.onReaderPopupShow(event);
      addon.data.selectedText = params.annotation.text?.trim();
      ztoolkit.log(addon.data.selectedText, "selected");
      addon.data.selectionContext = undefined;
      if (getPref("extend-selection-context"))
        addon.data.selectionContextPromise = getSelectionContext(reader, params);
      else addon.data.selectionContextPromise = Promise.resolve();
      // ztoolkit.log(doc);
      // ztoolkit.log(append);
      // ztoolkit.log("annotation", params.annotation);
      ztoolkit.log("Creating Ask AI Bar");
      addon.data.currentAnnotation = params.annotation;
      addon.data.currentReader = reader;
      if (reader._internalReader._type === "pdf")
        append(renderAIBar(doc));
    },
    config.addonID,
  );
}

function renderAIBar(doc: Document): DocumentFragment {
  // Insert styles
  if (
    !doc.querySelector(
      `link[href="chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css"]`,
    )
  ) {
    const styles = ztoolkit.UI.createElement(doc, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css`,
      },
    });
    doc.head?.appendChild(styles);
  }

  const disableAll = (container: HTMLElement) => {
    container.querySelectorAll("button, textarea").forEach((el: Element) => {
      (el as HTMLButtonElement | HTMLTextAreaElement).disabled = true;
    });
    container.querySelectorAll(".ai-send-btn").forEach((el: Element) => {
      (el as HTMLElement).classList.add("disabled");
    });
  };

  const btnListeners = (onClick: (e: Event) => Promise<void>) => [
    {
      type: "click",
      listener: (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        if (btn.disabled) return;

        const container = btn.closest(".ai-bar-container") as HTMLElement;
        if (container) disableAll(container);

        // Create ripple effect
        const ripple = btn.ownerDocument!.createElement("span");
        ripple.className = "ripple";
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = (e as MouseEvent).clientX - rect.left - size / 2;
        const y = (e as MouseEvent).clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        btn.appendChild(ripple);

        ripple.addEventListener("animationend", () => {
          ripple.remove();
        });

        e.stopPropagation();
        setTimeout(() => {
          const bar = btn.closest(".ai-bar-container") as HTMLElement;
          if (bar) bar.style.display = "none";
        }, 300);

        onClick(e);
      },
    },
  ];

  const handleAsk = async (
    input: HTMLTextAreaElement,
    container: HTMLElement,
    btn?: HTMLElement,
  ) => {
    const text = input.value.trim();
    if (text && addon.data.selectedText) {
      ztoolkit.log("Ask:", text, "Context:", addon.data.selectedText);
      disableAll(container);

      const requestId = generateRequestId();
      const messagesPromise = (async () => {
        try {
          if (addon.data.selectionContextPromise) {
            await addon.data.selectionContextPromise;
          }
        } catch (e) {
          ztoolkit.log("Get selection context failed:", e);
        }

        return [
          {
            role: "system",
            content:
              SYSTEM_PROMPT_PREFIX +
              `${addon.data.selectionContext?.[0]}\n<selected>\n${addon.data.selectedText}\n</selected>\n${addon.data.selectionContext?.[2]}`,
          },
          {
            role: "user",
            content: text,
          },
        ];
      })();

      // Trigger hooks for stream events
      await streamLLM(messagesPromise, {
        onStart: () => {
          addon.hooks.onLLMStreamStart({ requestId });
        },
        onUpdate: async (fullText) => {
          addon.hooks.onLLMStreamUpdate({ requestId, fullText });
        },
        onEnd: () => {
          addon.hooks.onLLMStreamEnd({ requestId });
        },
        onError: (error) => {
          addon.hooks.onLLMStreamError({ requestId, error });
        },
      });

      container.style.display = "none";
    }
  };

  const handleButtonAction = async (actionType: string) => {
    if (!addon.data.selectedText) return;
    ztoolkit.log("Action:", actionType, addon.data.selectedText);

    const requestId = generateRequestId();
    let prompt = "";

    const targetLanguage = Zotero.locale;
    // Define prompts for different actions
    switch (actionType) {
      case "explain":
        prompt = `Explain the <selected> text detailed in ${targetLanguage}.`;
        break;
      case "summarize":
        prompt = `Summarize the <selected> text concisely in ${targetLanguage}, highlighting the key points.`;
        break;
      case "translate":
        prompt = `
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

`;
        break;
      default:
        prompt = "Please analyze the text.";
    }

    const messagesPromise = (async () => {
      try {
        if (addon.data.selectionContextPromise) {
          await addon.data.selectionContextPromise;
        }
      } catch (e) {
        ztoolkit.log("Get selection context failed:", e);
      }

      return [
        {
          role: "system",
          content:
            SYSTEM_PROMPT_PREFIX +
            `${addon.data.selectionContext?.[0]}\n<selected>\n${addon.data.selectedText}\n</selected>\n${addon.data.selectionContext?.[2]}`,
        },
        { role: "user", content: prompt },
      ];
    })();

    // Trigger hooks for stream events
    await streamLLM(messagesPromise, {
      onStart: () => {
        addon.hooks.onLLMStreamStart({ requestId });
      },
      onUpdate: async (fullText) => {
        addon.hooks.onLLMStreamUpdate({ requestId, fullText });
      },
      onEnd: () => {
        addon.hooks.onLLMStreamEnd({ requestId });
      },
      onError: (error) => {
        addon.hooks.onLLMStreamError({ requestId, error });
      },
    });
  };

  return ztoolkit.UI.createElement(doc, "fragment", {
    children: [
      {
        tag: "div",
        classList: ["ai-bar-container"],
        children: [
          // 1. Explain
          {
            tag: "button",
            classList: ["ai-btn"],
            properties: {
              textContent: `\u{1F4D6}${getString("reader-bar-explain")}`,
            },
            listeners: btnListeners(async () => handleButtonAction("explain")),
          },
          // 2. Translate
          {
            tag: "button",
            classList: ["ai-btn"],
            properties: {
              textContent: `\u{1F310}${getString("reader-bar-translate")}`,
            },
            listeners: btnListeners(async () =>
              handleButtonAction("translate"),
            ),
          },
          // 3. Summarize
          {
            tag: "button",
            classList: ["ai-btn"],
            properties: {
              textContent: `\u{1F4DD}${getString("reader-bar-summarize")}`,
            },
            listeners: btnListeners(async () =>
              handleButtonAction("summarize"),
            ),
          },
          // 4. Ask (Input Group)
          {
            tag: "div",
            classList: ["input-group"],
            children: [
              {
                tag: "textarea",
                properties: {
                  placeholder: getString("reader-bar-ask-placeholder"),
                  rows: 1,
                },
                listeners: [
                  {
                    type: "blur",
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      if (!input.value) {
                        input.rows = 1;
                        input.style.height = "auto";
                      }
                    },
                  },
                  {
                    type: "input",
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      const group = input.parentElement as HTMLElement;
                      const bar = group.parentElement as HTMLElement;

                      if (input.value.length > 0) {
                        bar.classList.add("has-input");
                      } else {
                        bar.classList.remove("has-input");
                      }

                      // Auto grow height
                      input.style.height = "auto";
                      const newHeight = Math.min(input.scrollHeight, 100);
                      input.style.height = newHeight + "px";
                    },
                  },
                  {
                    type: "keydown",
                    listener: (e: Event) => {
                      const ke = e as KeyboardEvent;
                      ke.stopPropagation();
                      if (ke.key === "Enter" && !ke.shiftKey) {
                        ke.preventDefault();
                        const input = ke.currentTarget as HTMLTextAreaElement;
                        const bar = input.closest(
                          ".ai-bar-container",
                        ) as HTMLElement;
                        handleAsk(input, bar);
                      }
                    },
                  },
                ],
              },
              {
                tag: "div",
                classList: ["ai-send-btn"],
                properties: {
                  innerHTML: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
                },
                listeners: [
                  {
                    type: "click",
                    listener: (e: Event) => {
                      e.stopPropagation();
                      const btn = e.currentTarget as HTMLElement;
                      if (btn.classList.contains("disabled")) return;
                      const input =
                        btn.previousElementSibling as HTMLTextAreaElement;
                      const bar = btn.closest(
                        ".ai-bar-container",
                      ) as HTMLElement;
                      handleAsk(input, bar);
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}
