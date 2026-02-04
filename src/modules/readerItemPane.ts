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

function injectDebugTailwindScript(root: ShadowRoot) {
  const script = root.querySelector("#debug-tailwind-script");
  if (script) {
    script.remove();
  }
  const url = `chrome://${config.addonRef}/content/tailwind.js`;
  const newScript = document.createElement("script");
  newScript.id = "debug-tailwind-script";
  newScript.src = url;
  root.appendChild(newScript);
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
flex-direction: column; overflow-y: auto;max-height: 700px;overflow-x: hidden;gap: 8px;padding: 8px 0;"></div>`,
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
      // injectDebugTailwindScript(shadowRoot);
      injectCSS(shadowRoot, "katex.min.css");
      injectCSS(shadowRoot, "katex-swap.min.css");
      injectCSS(shadowRoot, "atom-one.css");
      injectCSS(shadowRoot, `../app.css`);

      const box = ChatBox(doc, false);
      const box2 = box.querySelector(".chat-message") as HTMLElement;
      const text = "Alright, markdown playground mode 🧪✨\nHere's a quick sampler—tell me if this is what you had in mind:\n\n---\n\n# Heading 1\n\n## Heading 2\n\n### Heading 3\n\n**Bold text**\n*Italic text*\n~~Strikethrough~~\n\n> This is a blockquote\n> Still quoting…\n\n---\n\n### Lists\n\n**Unordered**\n\n* Item one\n* Item two\n\n  * Sub-item\n\n**Ordered**\n\n1. First\n2. Second\n3. Third\n\n---\n\n### Code\n\nInline `code` looks like this.\n\nBlock code:\n\n```python\ndef hello():\n    print(\"Hello, markdown!\")\n```\n\n---\n\n### Links & Images\n\n[OpenAI](https://openai.com)\n\n![Placeholder image](https://via.placeholder.com/150)\n\n---\n\n### Tables\n\n| Column A | Column B |\n| -------: | :------- |\n|    Right | Left     |\n|      123 | abc      |\n\n---\n\nIf you're testing something specific (tables rendering, nested lists, emojis, math, etc.), say the word and I'll zero in on it 🔍😊\n";
      box2.innerHTML = await renderMarkdown(text);
      (box as HTMLElement).dataset.markdown = text;
      shadowRoot.append(box);

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
