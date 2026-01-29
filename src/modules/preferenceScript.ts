import { ZoteroToolkit } from "zotero-plugin-toolkit";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { openDialog } from "./modelDialog";

interface ModelProvider {
  label: string;
  value: string;
  defaultBaseURL: string;
  models: string[];
}

const PROVIDERS: Record<string, ModelProvider> = {
  openai: {
    label: "OpenAI (GPT)",
    value: "openai",
    defaultBaseURL: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  anthropic: {
    label: "Anthropic (Claude)",
    value: "anthropic",
    defaultBaseURL: "https://api.anthropic.com/v1",
    models: [
      "claude-3-5-sonnet-20240620",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
    ],
  },
  google: {
    label: "Google (Gemini)",
    value: "google",
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"],
  },
  deepseek: {
    label: "Deepseek AI",
    value: "deepseek",
    defaultBaseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  alibaba: {
    label: "Alibaba Cloud (Qwen)",
    value: "alibaba",
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus-latest", "qwen-max-latest", "qwen-flash", "qwen-max", "qwen-plus", "qwen-turbo-latest", "deepseek-v3.2"],
  },
  doubao: {
    label: "Volcengine (Doubao)",
    value: "doubao",
    defaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
  },
  custom: {
    label: "Custom",
    value: "custom",
    defaultBaseURL: "",
    models: [],
  },
};

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [
      ],
      rows: [
      ],
    };
  } else {
    addon.data.prefs.window = _window;
  }
  updatePrefsUI();
  bindPrefEvents();
}

function makeId(id: string): string {
  return `#${config.addonRef}-${id}`;
}

function updatePrefsUI() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;
  //? model settings
  const modelSelecter = doc.querySelector(makeId("model-selecter")) as HTMLSelectElement;
  const modelEditButton = doc.querySelector(makeId("model-edit-button")) as HTMLButtonElement;
  if (modelEditButton) {
    modelEditButton.addEventListener("click", () => {
      openDialog();
    });
  }

  const temperatureInput = doc.querySelector(makeId("temperature-input")) as HTMLInputElement;
  const temperatureLabel = doc.querySelector(makeId("temperature-value")) as HTMLElement;
  if (temperatureInput && temperatureLabel) {
    bindInputToLabel(temperatureInput, temperatureLabel,getPref("llm.temperature100"), 0.01);
  }
}


function bindPrefEvents() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;
}

function bindInputToLabel(input: HTMLInputElement, label: HTMLElement, initValue:number , scale: number = 1,) {
  input.addEventListener("input", ()=> {
    label.textContent = (Number(input.value) * scale).toFixed(2);
  });
  label.textContent = (initValue*scale).toFixed(2);
}
