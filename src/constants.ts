import { config } from "../package.json";

export function getLogoUrl(providerKey: string): string {
  return `chrome://${config.addonRef}/content/icons/${providerKey.toLowerCase()}.svg`;
}

export const PROVIDERS = {
  OPENAI: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    l10n: false,
    models: ['gpt-4o', 'gpt-4.1', 'gpt-5', 'gpt-5-mini', 'gpt-5.2', 'gpt-5.2-pro']
  },
  ANTHROPIC: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    l10n: false,
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5', 'claude-sonnet-4']
  },
  GOOGLE_CLOUD: {
    name: "Google Cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    l10n: false,
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-3-flash-preview']
  },
  // TODO: Add support for inline env like Azure
  // AZURE: {name: 'Azure OpenAI', baseUrl: 'https://YOUR_AZURE_RESOURCE_NAME.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT_NAME/'},
  ALIBABA_CLOUD: {
    name: "pref-provider-alibaba",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    l10n: true,
    models: ['qwen-plus', 'qwen3-max', 'qwen-flash', 'qwen-turbo']
  },
  VOLCENGINE: {
    name: "pref-provider-volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    l10n: true,
    models: ['doubao-seed-1.8', 'doubao-seed-1.6']
  },
  OPENROUTER: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    l10n: false,
    models: []
  },
} as const;
