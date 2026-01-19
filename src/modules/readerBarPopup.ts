import { config } from "../../package.json";
import { getSelectionContext } from "./selectionContext";
import { mockRequest } from "./task";

export function registerReaderInitializer() {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (event) => {
      const { reader, doc, params, append } = event;
      // addon.hooks.onReaderPopupShow(event);
      ztoolkit.log(addon.data.selectedText, "selected");
      getSelectionContext(reader, params);
      // ztoolkit.log(doc);
      // ztoolkit.log(append);
      ztoolkit.log(append);
      ztoolkit.log("Creating Ask AI Bar");
      const bar = renderAIBar(doc);
      append(bar);
    },
    config.addonID,
  );
}

function renderAIBar(doc: Document): DocumentFragment {
  // Insert styles for ripple and animations
  if (!doc.getElementById("ai-bar-styles")) {
    const style = doc.createElement("style");
    style.id = "ai-bar-styles";
    style.textContent = `
      /* AI Bar Animations */
      @keyframes ripple {
        to {
          transform: scale(4);
          opacity: 0;
        }
      }

      /* Ripple effect */
      .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        transform: scale(0);
        animation: ripple 0.6s linear;
        pointer-events: none;
      }

      /* AI Button */
      .ai-bar-container .ai-btn {
        position: relative;
        overflow: hidden;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.85);
        font-size: 12px;
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-weight: 500;
        max-width: 150px;
        white-space: nowrap;
      }

      .ai-bar-container .ai-btn:hover:not(:disabled) {
        background-color: rgba(255, 255, 255, 0.1);
        color: #fff;
      }

      .ai-bar-container .ai-btn:active:not(:disabled) {
        transform: scale(0.98);
      }

      .ai-bar-container .ai-btn:disabled {
        opacity: 0.6;
        cursor: default;
        pointer-events: none;
      }

      /* AI Bar Container */
      .ai-bar-container {
        transition: all 0.3s ease;
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        background: rgba(45, 45, 48, 0.98);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        z-index: 9999;
        pointer-events: auto;
        width: max-content;
      }

      /* Input Group */
      .ai-bar-container .input-group {
        display: flex;
        align-items: flex-end;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        padding: 2px 4px;
        margin-left: 2px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* Textarea */
      .ai-bar-container .input-group textarea {
        background: transparent;
        border: none;
        color: #fff;
        font-size: 12px;
        width: 70px;
        outline: none;
        padding: 4px 4px;
        transition: width 0.3s ease;
        resize: none;
        overflow: hidden;
        font-family: inherit;
        line-height: 1.4;
      }

      .ai-bar-container .input-group textarea:disabled {
        opacity: 0.6;
        cursor: default;
        pointer-events: none;
      }

      /* Send Button */
      .ai-bar-container .ai-send-btn {
        color: #0060df;
        cursor: pointer;
        display: flex;
        align-items: center;
        padding: 4px;
        opacity: 0.8;
        transition: opacity 0.2s;
        margin-bottom: 2px;
      }

      .ai-bar-container .ai-send-btn:hover {
        opacity: 1;
      }

      .ai-bar-container .ai-send-btn.disabled {
        opacity: 0.6;
        cursor: default;
        pointer-events: none;
      }
    `;
    doc.head?.appendChild(style);
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

      try {
        const res = await mockRequest(
          text + "\nContext: " + addon.data.selectedText,
        );
        ztoolkit.log(res);
      } catch (e) {
        ztoolkit.log("Ask error:", e);
      }

      // Re-enable logic skipped as window closes anyway, 
      // but if we were to keep it open we would need enableAll()

      container.style.display = "none";
    }
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
            listeners: btnListeners(async () => {
              if (addon.data.selectedText) {
                ztoolkit.log("Explain:", addon.data.selectedText);
                const res = await mockRequest(addon.data.selectedText);
                ztoolkit.log("Response:", res);
              }
            }),
          },
          // 2. Translate
          {
            tag: "button",
            classList: ["ai-btn"],
            properties: { textContent: "🌐Translate" },
            listeners: btnListeners(async () => {
              if (addon.data.selectedText) {
                ztoolkit.log("Translate:", addon.data.selectedText);
                const res = await mockRequest(addon.data.selectedText);
                ztoolkit.log("Response:", res);
              }
            }),
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
                    type: "focus",
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      const group = input.parentElement as HTMLElement;
                      input.style.width = "140px";
                      group.style.borderColor = "#0060df";
                    },
                  },
                  {
                    type: "blur",
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      const group = input.parentElement as HTMLElement;
                      const bar = group.parentElement as HTMLElement;
                      if (!input.value) {
                        input.style.width = "70px";
                        input.rows = 1;
                        group.style.borderColor = "rgba(255, 255, 255, 0.1)";

                        // Restore bar gap and sibling buttons
                        bar.style.gap = "6px";
                        Array.from(bar.children).forEach((child) => {
                          if (child !== group) {
                            const el = child as HTMLElement;
                            el.style.display = ""; // Reset display
                            el.style.maxWidth = "150px";
                            el.style.padding = "8px 12px";
                            el.style.margin = "";
                            el.style.opacity = "1";
                            el.style.pointerEvents = "auto";
                            // Ensure overflow/whitespace if needed, but they are in btnStyles or class
                          }
                        });
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
                        bar.style.gap = "0px";
                        Array.from(bar.children).forEach((child) => {
                          if (child !== group) {
                            const el = child as HTMLElement;
                            // Collapse animation properties
                            el.style.maxWidth = "0px";
                            el.style.padding = "0px";
                            el.style.margin = "0px";
                            el.style.opacity = "0";
                            el.style.pointerEvents = "none";
                          }
                        });
                        input.style.width = "250px";
                      } else {
                        // Restore if input becomes empty (optional user convenience)
                        bar.style.gap = "6px";
                        Array.from(bar.children).forEach((child) => {
                          if (child !== group) {
                            const el = child as HTMLElement;
                            el.style.maxWidth = "150px";
                            el.style.padding = "8px 12px";
                            el.style.margin = "";
                            el.style.opacity = "1";
                            el.style.pointerEvents = "auto";
                          }
                        });
                        // Input width restoration to focus mode (140px) or default (70px)? 
                        // Since it's focused, it should probably stay 140px or whatever focus width is.
                        // But previous logic expanded it to 250px immediately on input. 
                        // If empty, let's keep it at focus width (140px) if focused?
                        // Actually, let's just restore buttons.
                        input.style.width = "140px"; // Back to focus width
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
                tag: "div", classList: ["ai-send-btn"], properties: {
                  innerHTML: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
                },
                listeners: [
                  {
                    type: "click",
                    listener: (e: Event) => {
                      e.stopPropagation();
                      const btn = e.currentTarget as HTMLElement;
                      if (btn.classList.contains("disabled")) return;
                      const input = btn.previousElementSibling as HTMLTextAreaElement;
                      const bar = btn.closest(".ai-bar-container") as HTMLElement;
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
