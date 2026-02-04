import { config } from "../package.json";

export function getLogoUrl(providerKey: string): string {
  return `chrome://${config.addonRef}/content/icons/${providerKey.toLowerCase()}.svg`;
}

// export const SYSTEM_PROMPT_PREFIX = `# Role
// You are a helpful assistant integrated into Zotero, a research tool for managing documents. 

// # Task
// Your task is to assist users with their research-related queries based on the content of the documents parts. The content that users selected will be delimited by <selected> and </selected> tags.

// # Instructions
// - Focus solely on the content provided between the <selected> and </selected> tags. DO NOT TRANSLATE the content OUTSIDE these tags.
// - Formula may be the form of plain text sometimes. Handle them appropriately. 
// - If the information needed to answer a question is not present in the selected content or context, respond with "The provided content does not contain the information needed to answer this question."
// - Consider the context of these selected sections if necessary.
// - Do not make up answers or provide information that is not contained within the selected content.
// - Keep your responses concise and relevant to the user's query.

// # Output Format
// Provide your responses in Markdown format. Use appropriate headings, bullet points, and numbered lists to organize information clearly. When referencing specific sections from the selected content, use blockquotes or code blocks as needed to enhance clarity.
// Inline formula must be delimited by $...$ with a space before, Block formula must be delimited by $$...$$ block with a white line before. 

// # Content`;

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
    $$
    E=mc^2
    $$
    (empty lines before/after).

# Content`;

export const PROVIDERS = {
  OPENAI: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    l10n: false,
    models: [
      "gpt-4o",
      "gpt-4.1",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5.2",
      "gpt-5.2-pro",
    ],
  },
  ANTHROPIC: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    l10n: false,
    models: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-5",
      "claude-sonnet-4",
    ],
  },
  GOOGLE_CLOUD: {
    name: "Google Cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    l10n: false,
    models: [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
    ],
  },
  // TODO: Add support for inline env like Azure
  // AZURE: {name: 'Azure OpenAI', baseUrl: 'https://YOUR_AZURE_RESOURCE_NAME.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT_NAME/'},
  ALIBABA_CLOUD: {
    name: "pref-provider-alibaba",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    l10n: true,
    models: ["qwen-plus", "qwen3-max", "qwen-flash", "qwen-turbo"],
  },
  VOLCENGINE: {
    name: "pref-provider-volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    l10n: true,
    models: ["doubao-seed-1.8", "doubao-seed-1.6"],
  },
  OPENROUTER: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    l10n: false,
    models: [],
  },
} as const;
