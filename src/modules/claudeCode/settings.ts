import { saveV2Config, type AddedModel } from '../../utils/providers';
import { getPref, setPref } from '../../utils/prefs';
import { CLAUDE_CODE_PROVIDER_ID, CLAUDE_FALLBACK_MODELS, redactClaudeError, type ClaudeCodeModel } from './protocol';
import { checkClaudeCode, listClaudeCodeModels, stopClaudeCode } from './runtime';

/** Effort levels the CLI reported for a Claude Code model (the active one by default); [] when it has none. */
export function claudeCodeEfforts(modelId?: string): string[] {
  const v2 = addon.data.userProviderConfigV2;
  const id = modelId || (v2?.active?.providerId === CLAUDE_CODE_PROVIDER_ID ? v2.active.modelId : undefined);
  if (!id) return [];
  return v2?.addedModels.find((m) => m.providerId === CLAUDE_CODE_PROVIDER_ID && m.id === id)?.reasoningEfforts ?? [];
}

/** Like Codex: publish exactly the models the official CLI offers this account. */
export async function publishClaudeCodeModels(list: ClaudeCodeModel[] = CLAUDE_FALLBACK_MODELS): Promise<void> {
  const v2 = addon.data.userProviderConfigV2;
  if (!v2) throw new Error('Model settings have not loaded.');
  v2.addedProviders[CLAUDE_CODE_PROVIDER_ID] = {
    id: CLAUDE_CODE_PROVIDER_ID, name: 'Claude Code (local)', env: [], doc: 'https://code.claude.com/docs/en/overview',
  };
  const models: AddedModel[] = list.map(({ id, name, efforts }) => ({
    id, providerId: CLAUDE_CODE_PROVIDER_ID, name,
    enabled: v2.addedModels.find((m) => m.providerId === CLAUDE_CODE_PROVIDER_ID && m.id === id)?.enabled ?? true,
    family: `claude-${name.replace(/^Claude (Code · )?/, '').split(' ')[0].toLowerCase()}` as AddedModel['family'],
    reasoning: efforts.length > 0, reasoningEfforts: efforts, temperature: false, structured_output: false,
    modalities: { input: ['text', 'image'], output: ['text'] }, open_weights: false,
    cost: { input: 0, output: 0 }, limit: { context: 0, output: 0 },
  }));
  v2.addedModels = [...v2.addedModels.filter((m) => m.providerId !== CLAUDE_CODE_PROVIDER_ID), ...models];
  await saveV2Config(v2);
}

/** Older CLIs without a model list keep working with the plain aliases. */
async function discoverModels(command: string): Promise<ClaudeCodeModel[]> {
  return listClaudeCodeModels(command).catch(() => CLAUDE_FALLBACK_MODELS);
}

let refreshing: Promise<void> | undefined;

/**
 * Aliases resolve per CLI version (after an upgrade "opus" is the next Opus), so
 * the saved names are only valid for the CLI version that listed them. Re-read
 * the list when that version changes; a failed read keeps the current list and
 * is retried next time.
 */
export function refreshClaudeCodeModels(command: string, version: string, force = false): Promise<void> {
  if (!addon.data.userProviderConfigV2?.addedProviders[CLAUDE_CODE_PROVIDER_ID]) return Promise.resolve();
  if (!force && getPref('claudeCode.modelsVersion') === version) return Promise.resolve();
  refreshing ??= (async () => {
    try {
      const models = await listClaudeCodeModels(command);
      if (!addon.data.userProviderConfigV2?.addedProviders[CLAUDE_CODE_PROVIDER_ID]) return;
      await publishClaudeCodeModels(models);
      setPref('claudeCode.modelsVersion', version);
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

export async function disconnectClaudeCode(): Promise<void> {
  await stopClaudeCode();
  const v2 = addon.data.userProviderConfigV2;
  if (!v2) return;
  delete v2.addedProviders[CLAUDE_CODE_PROVIDER_ID];
  delete v2.env[CLAUDE_CODE_PROVIDER_ID];
  v2.addedModels = v2.addedModels.filter((m) => m.providerId !== CLAUDE_CODE_PROVIDER_ID);
  if (v2.active?.providerId === CLAUDE_CODE_PROVIDER_ID) { v2.active = undefined; setPref('llm.modelId', ''); }
  await saveV2Config(v2);
}

/** This panel lives in the plugin-owned modelDialog.html document. */
export function mountClaudeCodeSettings(doc: Document, win: Window): void {
  if (doc.getElementById('claude-code-settings')) return;
  const chinese = String(Zotero.locale).toLowerCase().startsWith('zh');
  const label = (en: string, zh: string) => chinese ? zh : en;
  const panel = doc.createElement('section');
  panel.id = 'claude-code-settings';
  panel.className = 'mb-6 rounded-2xl border border-gray-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900';
  const title = doc.createElement('h3');
  title.className = 'mb-2 font-semibold';
  title.textContent = 'Claude Code';
  const description = doc.createElement('p');
  description.className = 'mb-3 text-zinc-500';
  description.textContent = label(
    'Sign in with your subscription in the official Claude Code CLI first. Supports text, full-paper questions, images, translation and Agent mode with AI Bar\'s Zotero tools (Claude Code\'s own file and shell tools stay off). Models depend on your account.',
    '请先在官方 Claude Code 中登录订阅账号。支持选文、全文、图片问答、翻译，以及使用 AI Bar 文献库工具的 Agent 模式（Claude Code 自带的文件和命令工具保持关闭）。可用模型由你的账号决定。'
  );
  const path = doc.createElement('input');
  path.type = 'text';
  path.value = getPref('claudeCode.runtimePath') || '';
  path.placeholder = label('Claude executable path (blank = auto-detect)', 'Claude 程序路径（留空自动检测）');
  path.setAttribute('aria-label', path.placeholder);
  path.className = 'mb-3 w-full rounded border border-gray-200 bg-transparent p-2 dark:border-zinc-700';
  const status = doc.createElement('p');
  status.className = 'my-2 whitespace-pre-wrap';
  const controls = doc.createElement('div');
  controls.className = 'flex flex-wrap gap-3';
  const button = (text: string, run: () => Promise<void>) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.className = 'rounded border border-gray-200 px-3 py-1 dark:border-zinc-700';
    element.addEventListener('click', () => {
      for (const control of Array.from(controls.querySelectorAll('button'))) control.disabled = true;
      path.disabled = true;
      void run().catch((error) => { status.textContent = redactClaudeError(String(error.message || error)); }).finally(() => {
        if (win.closed) return;
        for (const control of Array.from(controls.querySelectorAll('button'))) control.disabled = false;
        path.disabled = false;
      });
    });
    controls.append(element);
  };
  button(label('Check login and enable', '检查登录并启用'), async () => {
    status.textContent = label('Checking official Claude Code…', '正在检查官方 Claude Code…');
    // Empty explicitly means auto-detect, including after a previous manual selection.
    setPref('claudeCode.runtimePath', path.value.trim());
    const info = await checkClaudeCode();
    if (win.closed) return;
    status.textContent = label('Reading the models available to your account…', '正在读取账号可用的模型…');
    const models = await discoverModels(info.path);
    if (win.closed) return;
    await publishClaudeCodeModels(models);
    setPref('claudeCode.modelsVersion', info.version);
    status.textContent = `${info.version} · ${info.plan}\n${models.map((m) => m.name).join(label(', ', '、'))}\n` +
      label('Enabled. Select a Claude Code model in the chat model menu.', '已启用，请在聊天模型菜单中选择 Claude Code 模型。');
  });
  button(label('Choose executable', '选择程序'), async () => {
    const selected = await new ztoolkit.FilePicker('Claude Code', 'open', undefined, undefined, win).open();
    if (selected && !win.closed) path.value = selected;
  });
  button(label('Remove from AI Bar', '从 AI Bar 移除'), async () => {
    await disconnectClaudeCode();
    status.textContent = label('Removed. Your official Claude Code login is unchanged.', '已移除。官方 Claude Code 的登录状态保持不变。');
  });
  const enabled = !!addon.data.userProviderConfigV2?.addedProviders[CLAUDE_CODE_PROVIDER_ID];
  status.textContent = enabled
    ? label('Enabled; login is checked before each request.', '已启用，每次请求前会检查登录状态。')
    : label('Not enabled.', '尚未启用。');
  panel.append(title, description, path, controls, status);
  doc.getElementById('provider-block')?.before(panel);
  // Aliases move to new versions ("opus" → the next Opus); refresh the names
  // in the background so the menu shows what each alias resolves to now.
  if (enabled) {
    void checkClaudeCode()
      .then((info) => refreshClaudeCodeModels(info.path, info.version, true))
      .catch(() => undefined);
  }
}
