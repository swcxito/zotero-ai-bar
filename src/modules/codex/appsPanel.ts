import { InlineButton } from '../../components/buttons/inlineButton';
import { Icons } from '../../components/common';
import { appInstallUrl, selectApp, selectedAppIds, visibleApps } from './apps';
import { codexRuntime } from './runtime';
import { codexString } from './i18n';

const renderedState = new WeakMap<HTMLElement, string>();

/** This panel is mounted in the add-on-owned model settings document. */
export function renderAppsPanel(container: HTMLElement): void {
  const doc = container.ownerDocument;
  let panel = container.querySelector<HTMLDetailsElement>('details[data-codex-apps]');
  if (!panel) {
    panel = doc.createElement('details');
    panel.dataset.codexApps = 'true';
    panel.className = 'mt-3 border-t border-gray-200 pt-3 text-sm dark:border-zinc-700';
    const summary = doc.createElement('summary');
    summary.className = 'cursor-pointer font-medium';
    summary.textContent = codexString('codex-apps-title', 'ChatGPT 应用（Agent 模式）');
    const content = doc.createElement('div');
    content.setAttribute('data-codex-apps-content', '');
    content.className = 'mt-2 flex flex-col gap-2';
    panel.append(summary, content);
    panel.addEventListener('toggle', function () {
      if (this.open) codexRuntime.loadAppsOnce();
    });
    container.append(panel);
  }
  const account = codexRuntime.accountKey;
  const selected = account ? selectedAppIds(account) : [];
  const apps = visibleApps(codexRuntime.apps, selected);
  const visibleIds = new Set(apps.map((app) => app.id));
  const hidden = codexRuntime.apps.filter((app) => !visibleIds.has(app.id)).length;
  const fingerprint = JSON.stringify([account, selected, apps, hidden, codexRuntime.appsLoading, codexRuntime.appsStatus]);
  if (renderedState.get(panel) === fingerprint) return;
  renderedState.set(panel, fingerprint);
  const content = panel.querySelector('[data-codex-apps-content]')!;
  content.replaceChildren();
  const help = doc.createElement('p');
  help.textContent = codexString(
    'codex-apps-help',
    '勾选要在 Agent 模式中使用的已连接应用。在 ChatGPT 中连接新应用后点击刷新；选择从下一轮对话生效。'
  );
  const refresh = ztoolkit.UI.createElement(
    doc,
    'button',
    InlineButton({
      label: codexString('codex-apps-refresh', '刷新应用'),
      iconMarkup: Icons.Redo,
      onClicked: () => void codexRuntime.refreshApps().catch(() => undefined),
    })
  ) as HTMLButtonElement;
  refresh.type = 'button';
  refresh.disabled = !account || codexRuntime.appsLoading;
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = codexRuntime.appsLoading
    ? codexString('codex-apps-loading', '正在读取应用…')
    : codexRuntime.appsStatus ||
      (!codexRuntime.apps.length ? codexString('codex-apps-empty', '尚无应用列表，请刷新。应用是否可用取决于当前账号和运行时。') : '');
  content.append(help, refresh, status);
  for (const app of apps) {
    const row = doc.createElement('div');
    row.className = 'flex flex-wrap items-center gap-2';
    const label = doc.createElement('label');
    label.className = 'flex items-center gap-2';
    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.includes(app.id);
    checkbox.disabled = !account || (!app.isAccessible && !checkbox.checked);
    checkbox.addEventListener('change', () => {
      if (codexRuntime.accountKey !== account || !account) return;
      selectApp(account, app.id, checkbox.checked);
      codexRuntime.changed();
    });
    const name = doc.createElement('span');
    name.textContent = `${app.name} · ${app.isAccessible ? codexString('codex-apps-accessible', '有访问权限') : codexString('codex-apps-unavailable', '需连接或无访问权限')}`;
    name.title = app.description;
    label.append(checkbox, name);
    row.append(label);
    const url = appInstallUrl(app.installUrl);
    if (url) {
      const link = doc.createElement('button');
      link.type = 'button';
      link.className = 'text-blue-600 underline';
      link.textContent = codexString('codex-apps-manage', '连接 / 管理');
      link.addEventListener('click', () => Zotero.launchURL(url));
      row.append(link);
    }
    content.append(row);
  }
  if (hidden > 0) {
    const more = doc.createElement('p');
    more.className = 'text-zinc-500';
    more.textContent = codexString('codex-apps-hidden', `目录中另有 ${hidden} 个未连接的应用。在 ChatGPT 中连接后刷新，即可在这里勾选。`, {
      count: hidden,
    });
    content.append(more);
  }
}
