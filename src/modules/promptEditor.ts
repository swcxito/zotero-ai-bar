import { config } from "../../package.json";
import { InlineButton } from "../components/inlineButton";
import { UserPrompt } from "../types";
import { setPref } from "../utils/prefs";
import { getLocaleID, getString } from "../utils/locale";

export async function openPromptEditor(onClosed: () => void = () => {}) {
  const windowArgs = {
    onBodyLoaded: onPromptEditorLoad,
    onWindowClosed: onClosed,
  };
  Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/promptEditor.html`,
    `${config.addonRef}-prompt-editor`,
    "chrome,centerscreen,resizable,status,dialog=no,width=800,height=550",
    windowArgs,
  );
}

export class PromptEditor {
  private doc: Document;
  private promptList: HTMLElement | null;
  private editPanel: HTMLElement | null;
  private nameInput: HTMLInputElement | null;
  private descInput: HTMLInputElement | null;
  private contentInput: HTMLTextAreaElement | null;
  private selectedPromptId: string | null = null;
  private prompts: UserPrompt[] = [];

  constructor(private win: Window) {
    this.doc = win.document;
    this.promptList = this.doc.querySelector("#prompt-list");
    this.editPanel = this.doc.querySelector("#prompt-edit-panel");
    this.nameInput = this.doc.querySelector("#prompt-name-input");
    this.descInput = this.doc.querySelector("#prompt-desc-input");
    this.contentInput = this.doc.querySelector("#prompt-content-input");
    this.prompts = JSON.parse(JSON.stringify(addon.data.userPrompts || []));
  }

  init() {
    this.renderList();
    this.clearEditForm();
    this.bindAddButton();
    this.bindEditButtons();
    this.bindDragSort();
    this.win.addEventListener("unload", () => {
      this.save();
      this.win.arguments[0].onWindowClosed();
    });
  }

  renderList() {
    if (!this.promptList) return;

    this.promptList.replaceChildren();

    if (!this.prompts.length) {
      const emptyState = this.doc.createElement("div");
      emptyState.className =
        "rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400";
      emptyState.textContent = getString("pref-prompteditor-empty-state");
      this.promptList.appendChild(emptyState);
      return;
    }

    this.prompts.forEach((prompt) => {
      this.promptList?.appendChild(this.createPromptRow(prompt));
    });
  }

  createPromptRow(prompt: UserPrompt) {
    const row = this.doc.createElement("div");
    const selected = this.selectedPromptId === prompt.id;
    row.className = [
      "group flex items-center justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm transition-all cursor-pointer dark:bg-zinc-900",
      selected
        ? "border-rose-400 ring-1 ring-rose-300 dark:border-rose-400 dark:ring-rose-800"
        : "border-zinc-200 hover:border-rose-400 dark:border-zinc-700 dark:hover:border-rose-400",
    ].join(" ");
    row.draggable = true;
    row.dataset.promptId = prompt.id;
    row.dataset.index = String(
      this.prompts.findIndex((item) => item.id === prompt.id),
    );

    const content = this.doc.createElement("div");
    content.className = "flex items-center gap-3 overflow-hidden";

    const handle = this.doc.createElement("div");
    handle.className =
      "cursor-grab text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300";
    handle.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="5" r="1"></circle>
        <circle cx="9" cy="12" r="1"></circle>
        <circle cx="9" cy="19" r="1"></circle>
        <circle cx="15" cy="5" r="1"></circle>
        <circle cx="15" cy="12" r="1"></circle>
        <circle cx="15" cy="19" r="1"></circle>
      </svg>
    `;

    const textWrap = this.doc.createElement("div");
    textWrap.className = "flex flex-col overflow-hidden";

    const name = this.doc.createElement("span");
    name.className = "truncate font-medium text-zinc-900 dark:text-zinc-100";
    name.textContent = prompt.name || "Untitled Prompt";

    const desc = this.doc.createElement("span");
    desc.className = "truncate text-sm text-zinc-500 dark:text-zinc-400";
    desc.textContent = prompt.description || "No description";

    textWrap.append(name, desc);
    content.append(handle, textWrap);

    const deleteButton = this.doc.createElement("button");
    deleteButton.className =
      "opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-opacity focus:opacity-100";
    deleteButton.type = "button";
    deleteButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;

    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.prompts = this.prompts.filter((item) => item.id !== prompt.id);
      if (this.selectedPromptId === prompt.id) {
        this.clearEditForm();
      }
      this.renderList();
    });

    row.addEventListener("click", () => {
      this.selectPrompt(prompt.id);
    });

    row.append(content, deleteButton);
    return row;
  }

  bindAddButton() {
    const addButtonHost = this.doc.querySelector<HTMLElement>(
      "#prompt-add-button-host",
    );
    if (!addButtonHost) return;

    const addButton = ztoolkit.UI.createElement(
      this.doc,
      "button",
      InlineButton({
        onClicked: () => {
          const newPrompt: UserPrompt = {
            id: crypto.randomUUID(),
            name: "New Prompt",
            description: "",
            prompt: "",
          };
          this.prompts.push(newPrompt);
          this.renderList();
          this.selectPrompt(newPrompt.id);
        },
        label: "Add Prompt",
        classList: [
          "flex",
          "w-full",
          "items-center",
          "justify-center",
          "gap-2",
          "rounded-xl",
          "border-2",
          "border-dashed",
          "border-zinc-300",
          "p-4",
          "text-sm",
          "font-semibold",
          "text-zinc-500",
          "transition-all",
          "duration-200",
          "ease-out",
          "hover:-translate-y-[1px]",
          "active:translate-y-0",
          "hover:border-zinc-400",
          "hover:text-zinc-700",
          "dark:border-zinc-600",
          "dark:text-zinc-400",
          "dark:hover:border-zinc-500",
          "dark:hover:text-zinc-300",
        ],
      }),
    ) as HTMLButtonElement;

    const labelElement = addButton.querySelector(".inline-button-label");
    if (labelElement) {
      labelElement.setAttribute(
        "data-l10n-id",
        getLocaleID("pref-prompteditor-button-add"),
      );
    }

    addButtonHost.replaceChildren(addButton);
    void (this.doc as any).l10n?.translateFragment(addButtonHost);
  }

  bindEditButtons() {
    const saveButton =
      this.doc.querySelector<HTMLButtonElement>("#prompt-save-btn");
    const cancelButton =
      this.doc.querySelector<HTMLButtonElement>("#prompt-cancel-btn");

    saveButton?.addEventListener("click", () => {
      if (!this.selectedPromptId) return;

      const prompt = this.prompts.find(
        (item) => item.id === this.selectedPromptId,
      );
      if (!prompt) return;

      prompt.name = this.nameInput?.value.trim() || "Untitled Prompt";
      prompt.description = this.descInput?.value.trim() || "";
      prompt.prompt = this.contentInput?.value || "";
      this.renderList();
    });

    cancelButton?.addEventListener("click", () => {
      this.clearEditForm();
    });
  }

  bindDragSort() {
    let draggedIndex: number | null = null;

    this.promptList?.addEventListener("dragstart", (event) => {
      const row = (event.target as HTMLElement | null)?.closest(
        "[data-prompt-id]",
      ) as HTMLElement | null;
      if (!row) return;

      draggedIndex = Number(row.dataset.index);
      event.dataTransfer?.setData("text/plain", row.dataset.index || "");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });

    this.promptList?.addEventListener("dragover", (event) => {
      const row = (event.target as HTMLElement | null)?.closest(
        "[data-prompt-id]",
      );
      if (!row) return;

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    this.promptList?.addEventListener("drop", (event) => {
      const row = (event.target as HTMLElement | null)?.closest(
        "[data-prompt-id]",
      ) as HTMLElement | null;
      if (!row || draggedIndex === null) return;

      event.preventDefault();
      const dropIndex = Number(row.dataset.index);
      if (Number.isNaN(dropIndex) || dropIndex === draggedIndex) {
        draggedIndex = null;
        return;
      }

      const [movedPrompt] = this.prompts.splice(draggedIndex, 1);
      if (!movedPrompt) {
        draggedIndex = null;
        return;
      }

      this.prompts.splice(dropIndex, 0, movedPrompt);
      draggedIndex = null;
      this.renderList();
    });

    this.promptList?.addEventListener("dragend", () => {
      draggedIndex = null;
    });
  }

  selectPrompt(id: string) {
    const prompt = this.prompts.find((item) => item.id === id);
    if (!prompt) return;

    this.selectedPromptId = id;
    if (this.nameInput) {
      this.nameInput.value = prompt.name;
    }
    if (this.descInput) {
      this.descInput.value = prompt.description;
    }
    if (this.contentInput) {
      this.contentInput.value = prompt.prompt;
    }
    this.editPanel?.classList.remove("opacity-60", "pointer-events-none");
    this.renderList();
  }

  clearEditForm() {
    this.selectedPromptId = null;
    if (this.nameInput) {
      this.nameInput.value = "";
    }
    if (this.descInput) {
      this.descInput.value = "";
    }
    if (this.contentInput) {
      this.contentInput.value = "";
    }
    this.editPanel?.classList.add("opacity-60", "pointer-events-none");
    this.renderList();
  }

  save() {
    addon.data.userPrompts = this.prompts;
    setPref("prompt.userPrompts", JSON.stringify(this.prompts));
  }
}

export async function onPromptEditorLoad(window: Window) {
  await (window.document as any).l10n?.translateFragment(
    window.document.documentElement,
  );
  new PromptEditor(window).init();
}
