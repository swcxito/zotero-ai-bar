import { IconView } from '../iconView';
import { Icons } from '../common';

const ENABLED = ['bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600'] as const;
const DISABLED = ['bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600'] as const;

export function setSendBtnEnabled(button: HTMLButtonElement, enabled: boolean): void {
  button.disabled = !enabled;
  button.classList.remove(...(enabled ? DISABLED : ENABLED));
  button.classList.add(...(enabled ? ENABLED : DISABLED));
}

export function setSendButtonMode(button: HTMLButtonElement, streaming: boolean): void {
  button.dataset.mode = streaming ? 'stop' : 'send';
  button.replaceChildren(
    ztoolkit.UI.createElement(
      button.ownerDocument,
      'span',
      IconView({
        iconMarkup: streaming ? Icons.Stop : Icons.Send,
        sizeRem: 1.5,
        extraClasses: ['text-white'],
      })
    )
  );
  if (streaming) setSendBtnEnabled(button, true);
}
