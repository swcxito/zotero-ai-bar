import { getString } from '../utils/locale';

interface RuntimeSettingsOptions {
  provider: 'codex' | 'claude-code';
  path: string;
  description: string;
  help: 'codex-integration' | 'claude-code-integration';
  checkLogin: (path: string) => void;
  install: () => void;
  disconnectOrCancel: () => void;
}

export function createSubscriptionRuntimeSettings(doc: Document, win: Window, options: RuntimeSettingsOptions) {
  const { provider } = options;
  const root = doc.createElement('div');
  root.className = 'relative border-t border-gray-200 pt-3 dark:border-zinc-700';
  const panel = doc.createElement('details');
  panel.id = `${provider}-connection-panel`;
  const summary = doc.createElement('summary');
  summary.className = 'cursor-pointer pr-28 font-medium leading-8';
  summary.textContent = getString('subscription-runtime-settings');

  const description = doc.createElement('p');
  description.className = 'my-2 text-zinc-600 dark:text-zinc-300';
  description.textContent = options.description;

  const status = doc.createElement('p');
  status.id = `${provider}-connection-status`;
  status.className = 'my-2 whitespace-pre-wrap break-words text-zinc-600 empty:hidden dark:text-zinc-300';
  status.setAttribute('role', 'status');

  const path = doc.createElement('input');
  path.type = 'text';
  path.id = `${provider}-runtime-path`;
  path.value = options.path;
  path.placeholder = getString('subscription-runtime-path');
  path.setAttribute('aria-label', path.placeholder);
  path.className = 'my-2 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 dark:border-zinc-600';

  const controls = doc.createElement('div');
  controls.className = 'mt-1 flex flex-wrap items-center gap-2';
  function button(id: string, label: string, action: () => void) {
    const node = doc.createElement('button');
    node.type = 'button';
    node.id = id;
    node.textContent = label;
    node.className =
      'rounded-lg border border-gray-300 px-3 py-1 transition-colors hover:bg-gray-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800';
    node.addEventListener('click', action);
    return node;
  }
  const check = button(`${provider}-check-login`, getString('subscription-check-login'), () => options.checkLogin(path.value.trim()));
  const choose = button(`${provider}-choose-program`, getString('subscription-choose-program'), () => {
    void new ztoolkit.FilePicker(getString('subscription-choose-program'), 'open', undefined, undefined, win)
      .open()
      .then((selected) => {
        if (selected && !win.closed) path.value = selected;
      })
      .catch((error) => {
        status.textContent = String((error as Error).message || error);
      });
  });
  const install = button(`${provider}-install-cli-button`, getString('subscription-install-cli'), options.install);
  const language = String(Zotero.locale).toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
  const help = doc.createElement('a');
  help.href = `https://zotero.fukeke.com/${language}/reference/${options.help}/`;
  help.textContent = getString('subscription-install-help');
  help.className = 'text-rose-600 underline underline-offset-2 hover:text-rose-500 dark:text-rose-400 dark:hover:text-rose-300';
  help.addEventListener('click', (event) => {
    event.preventDefault();
    Zotero.launchURL(help.href);
  });
  controls.append(check, choose, install, help);
  panel.append(summary, description, status, path, controls);

  const end = button(`${provider}-connection-action`, '', options.disconnectOrCancel);
  end.classList.add('absolute', 'right-0', 'top-3', 'h-8');
  root.append(panel, end);
  return {
    root,
    panel,
    status,
    setState(connected: boolean, busy: boolean) {
      const label = getString(connected ? 'subscription-disconnect' : 'subscription-cancel-connect');
      if (end.textContent !== label) end.textContent = label;
      end.disabled = connected && busy;
      for (const control of [path, check, choose, install]) control.disabled = busy;
    },
  };
}
