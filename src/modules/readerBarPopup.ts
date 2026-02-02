import { config } from "../../package.json";
import { getSelectionContext } from "./selectionContext";
import { streamLLM } from "../utils/llmRequest";
import { SYSTEM_PROMPT_PREFIX } from "../constants";

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
      ztoolkit.log(addon.data.selectedText, "selected");
      getSelectionContext(reader, params).then();
      // ztoolkit.log(doc);
      // ztoolkit.log(append);
      ztoolkit.log(append);
      ztoolkit.log("Creating Ask AI Bar");
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
      const messages = [
        {
          role: "system",
          content:
            SYSTEM_PROMPT_PREFIX +
            `${addon.data.userPrompt?.[0]}\n<selected>\n${addon.data.selectedText}\n</selected>\n${addon.data.userPrompt?.[2]}`,
        },
        {
          role: "user",
          content: text,
        },
      ];

      // Trigger hooks for stream events
      await streamLLM(messages, {
        onStart: () => {
          addon.hooks.onLLMStreamStart({ requestId });
        },
        onUpdate: async (fullText) => {
          addon.hooks.onLLMStreamUpdate({ requestId, fullText });
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

    const targetLanguage = "Chinese";
    // Define prompts for different actions
    switch (actionType) {
      case "explain":
        prompt = `Please explain the text detailed in Chinese.`;
        break;
      case "translate":
        prompt = `Translate the provided text into ${targetLanguage}.
If I select a single word, provide its IPA pronunciation, part of speech, a concise meanings in the context, and more meanings.
If I select an abbreviation or acronym, provide its full form and a brief explanation.
If I select a sentence or paragraph, provide a clear and accurate translation only.
Keep the response concise and clearly structured.
The following are some English to Chinese examples:
## Example-1:
Work adopted a 
<selected>
single
</selected>
green micro-LED.
## Response-1:
**single**
英 / ˈsɪŋɡ(ə)l /
美 / ˈsɪŋɡ(ə)l /
**adj. 单一的，单个的；**
-----
adj. 独自的，孤独的；单身的，未婚的；
n. 单数；单曲唱片；

## Example-2:
He is still
<selected>
single
</selected>
.
## Response-2:
**single**
英 / ˈsɪŋɡ(ə)l /
美 / ˈsɪŋɡ(ə)l /
**adj. 单身的，未婚的；**
-----
adj. 独自的，孤独的；单一的，单个的；
n. 单数；单曲唱片；

## Example-3:
<selected>NASA</selected>
## Response-3:
**NASA**
abbr. 美国国家航空和宇宙航行局（National Aeronautics and Space Administration）
美国国家航空航天局是美国联邦政府负责民用太空探索、航空研究和空间科学研究的机构。
`;
        break;
      default:
        prompt = "Please analyze the text.";
    }

    const messages = [
      {
        role: "system",
        content:
          SYSTEM_PROMPT_PREFIX +
          `${addon.data.userPrompt?.[0]}\n<selected>\n${addon.data.selectedText}\n</selected>\n${addon.data.userPrompt?.[2]}`,
      },
      { role: "user", content: prompt },
    ];

    // Trigger hooks for stream events
    await streamLLM(messages, {
      onStart: () => {
        addon.hooks.onLLMStreamStart({ requestId });
      },
      onUpdate: async (fullText) => {
        addon.hooks.onLLMStreamUpdate({ requestId, fullText });
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
            properties: { textContent: "📖Explain" },
            listeners: btnListeners(async () => handleButtonAction("explain")),
          },
          // 2. Translate
          {
            tag: "button",
            classList: ["ai-btn"],
            properties: { textContent: "🌐Translate" },
            listeners: btnListeners(async () =>
              handleButtonAction("translate"),
            ),
          },
          // 3. Ask (Input Group)
          {
            tag: "div",
            classList: ["input-group"],
            children: [
              {
                tag: "textarea",
                properties: {
                  placeholder: "Ask AI...",
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
