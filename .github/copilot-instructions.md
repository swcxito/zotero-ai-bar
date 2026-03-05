# Copilot Instructions for zotero-ai-bar

## Big picture architecture
- This is a Zotero plugin built with `zotero-plugin-scaffold` and loaded from `addon/bootstrap.js`.
- Runtime entry is `src/index.ts`, which creates a singleton `Addon` instance and exposes `ztoolkit` globally.
- Shared runtime state lives in `addon.data` (see `src/addon.ts`): current reader/annotation, selected text/context, provider configs, active abort controller, and last request messages.
- Hook lifecycle and event dispatch are centralized in `src/hooks.ts` (`onStartup`, `onMainWindowLoad`, stream callbacks, prefs events).

## Core request/data flow (read before editing AI behavior)
- Selection popup UI is registered in `src/modules/readerBarPopup.ts` via `Zotero.Reader.registerEventListener("renderTextSelectionPopup", ...)`.
- Prompt assembly uses `SYSTEM_PROMPT_PREFIX` + selected text/context from `src/modules/prompts.ts` and `src/modules/selectionContext.ts`.
- Streaming transport is in `src/utils/llmRequest.ts` (`streamLLM`):
  - Cancels prior requests via `addon.data.abortController`.
  - Resolves selected model from `llm.modelId` against `addon.data.userProviderConfigs`.
  - Calls OpenAI-compatible `/chat/completions` SSE and applies provider-specific flags (e.g., ZHIPU/ZAI/ALIBABA_CLOUD/MINIMAX).
- Stream rendering is callback-driven in `src/hooks.ts` (`onLLMStreamStart/Update/End/Error`) and updates chat DOM incrementally.

## UI/component patterns specific to this repo
- UI is built with `ztoolkit.UI.createElement` factories in `src/components/*` (no React/Vue).
- Reader item pane chat is mounted into Shadow DOM in `src/modules/readerItemPane.ts`; styles are injected with `injectCSS` using `chrome://...` URLs.
- Prefer extending existing component factories (`ChatBox`, `AiActionButton`, `ProviderCard`, `ModelInfo`) over ad-hoc DOM mutation.
- Tailwind source is `src/styles/app.css`; generated file `addon/content/app.css` is build output.

## Preferences, i18n, and configuration
- Preferences are namespaced by `config.prefsPrefix` (`src/utils/prefs.ts`, defaults in `addon/prefs.js`, typings in `typings/prefs.d.ts`).
- Provider settings are persisted as JSON string in `llm.providerConfigs`; model switching relies on stable per-model `id`.
- Locale strings use Fluent (`addon/locale/*/*.ftl`) and `getString/getLocaleID` from `src/utils/locale.ts`.
- Keep IDs/paths derived from `package.json` config (`addonRef`, `addonID`, `addonInstance`) instead of hardcoding.

## Developer workflows (project-specific)
- Install deps: `pnpm install`
- Dev (Zotero + css watch): `pnpm start`
- CSS watch only: `pnpm dev:css`
- Build distributable: `pnpm build` (outputs to `.scaffold/build` and performs `tsc --noEmit`)
- Test plugin startup/integration: `pnpm test`
- Lint/format: `pnpm lint:check`, `pnpm lint:fix`

## Editing guardrails for agents
- Keep hooks as dispatchers; put heavy logic in modules/utils (explicitly documented in `src/hooks.ts`).
- Preserve streaming callback contract (`onStart/onUpdate/onEnd/onError`) when changing request/render code.
- When touching selection context logic, verify both search-based and position-based fallback paths in `src/modules/selectionContext.ts`.
- Follow existing ESLint/Prettier setup (`eslint.config.mjs`, `prettier.config.js`) and keep changes minimal/surgical.
- Existing AI conventions source scan found only `README.md`; no prior agent rules file existed.
