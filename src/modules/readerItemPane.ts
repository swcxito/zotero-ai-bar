import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";
import { ChatBox } from "../components/chatBox";
import { renderMarkdown } from "../utils/markdown";
import { streamLLM } from "../utils/llmRequest";

export function injectCSS(doc: Document | ShadowRoot, filename: string) {
  // 获取插件内资源的 URL
  const url = `chrome://${config.addonRef}/content/styles/${filename}`;

  // 防止重复注入
  if (doc.querySelector(`link[href="${url}"]`)) return;

  // 判断是否是 ShadowRoot（通过检查 host 属性而不是 instanceof）
  const isShadowRoot = "host" in doc && !("head" in doc);
  const ownerDoc = isShadowRoot
    ? (doc as any).ownerDocument
    : (doc as Document);

  const link = ownerDoc.createElement("link");
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = url;

  // 处理 ShadowRoot 和 Document 的区别
  if (isShadowRoot) {
    doc.appendChild(link);
  } else {
    (doc as Document).head.appendChild(link);
  }
}

export async function registerReaderItemPaneSection() {
  // Setup LLM callbacks to update UI
  if (!addon.data.sectionMap) {
    addon.data.sectionMap = new Map();
  }

  Zotero.ItemPaneManager.registerSection({
    paneID: "ai-bar-reader",
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("item-section-head-text"),
      icon: `chrome://${config.addonRef}/content/icons/favicon.svg`,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-sidenav-tooltip"),
      icon: `chrome://${config.addonRef}/content/icons/favicon.svg`,
    },
    // Optional
    bodyXHTML: `<div id="ai-bar-chat-root" style="width: 100%;display: flex;
flex-direction: column; overflow-y: auto;max-height: 700px;overflow-x: hidden;gap: 8px;padding: 8px 0"></div>`,
    // Optional, Called when the section is first created, must be synchronous
    onInit: ({ item }) => {
      // ztoolkit.log("Section init!", item?.id);
    },
    // Optional, Called when the section is destroyed, must be synchronous
    onDestroy: (props) => {
      // ztoolkit.log("Section destroy!");
      // Note: props.item is not available in onDestroy, cleanup is handled in onItemChange
    },
    // Optional, Called when the section data changes (setting item/mode/tabType/inTrash), must be synchronous. return false to cancel the change
    onItemChange: ({ item, setEnabled, tabType }) => {
      ztoolkit.log(`Section item data changed to ${item?.id}`);
      addon.data.currentSection = item?.id;
      setEnabled(tabType === "reader");
      return true;
    },
    // Called when the section is asked to render, must be synchronous.
    onRender: ({
      doc,
      body,
      item,
      setSectionSummary,
      setSectionButtonStatus,
    }) => {
      setSectionSummary("TODO!");
      setSectionButtonStatus("clear", { hidden: true });
    },
    // Optional, can be asynchronous.
    onAsyncRender: async ({
      body,
      doc,
      item,
      setL10nArgs,
      setSectionSummary,
      setSectionButtonStatus,
    }) => {
      if (item && addon.data.sectionMap)
        addon.data.sectionMap.set(item.id, body);
      const root = body.querySelector("#ai-bar-chat-root") as HTMLElement;
      const shadowRoot = root.attachShadow({ mode: "open" });

      // 将 CSS 注入到 Shadow DOM 中
      injectCSS(shadowRoot, `../app.css`);
      injectCSS(shadowRoot, "katex.min.css");
      injectCSS(shadowRoot, "katex-swap.min.css");
      injectCSS(shadowRoot, "atom-one-light.min.css");

      // shadowRoot.append(ChatBox(doc, true));

      // setSectionButtonStatus("test", { hidden: false });
    },
    // Optional, Called when the section is toggled. Can happen anytime even if the section is not visible or not rendered
    // onToggle: ({ item }) => {
    //   ztoolkit.log("Section toggled!", item?.id);
    // },
    // Optional, Buttons to be shown in the section header
    sectionButtons: [
      // {
      //   type: "clear",
      //   icon: "chrome://zotero/skin/16/universal/empty-trash.svg",
      //   l10nID: getLocaleID("item-section-example2-button-tooltip"),
      //   onClick: ({ item, paneID }) => { },
      // },
      {
        type: "test",
        icon: `chrome://${config.addonRef}/content/icons/openai.svg`,
        // l10nID: getLocaleID("item-section-example2-button-tooltip"),
        onClick: async ({ item, paneID }) => {
          const body = addon.data.sectionMap?.get(item.id);
          if (!body) return;

          const root = body.querySelector("#ai-bar-chat-root");
          if (!root || !root.shadowRoot) return;
          const shadowRoot = root.shadowRoot;
          const doc = body.ownerDocument;
        },
      },
    ],
  });
}
