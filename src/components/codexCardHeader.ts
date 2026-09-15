import type { TagElementProps } from 'zotero-plugin-toolkit';

/** Marks the head detail block so refreshes can swap it without touching the rest of the card. */
export const CODEX_HEAD_DETAILS_CLASS = 'codex-head-details';

export function maskAccountEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = Array.from(email.slice(0, at));
  return `${local[0]}***${local.length > 4 ? local.at(-1) : ''}${email.slice(at)}`;
}

export function codexHeaderDetails(email: string, plan: string | undefined, runtime: string): TagElementProps[] {
  const tiers: Record<string, [string, string[]]> = {
    free: ['Free', ['border-zinc-400', 'text-zinc-600', 'dark:text-zinc-300']],
    go: ['Go', ['border-cyan-500', 'text-cyan-700', 'dark:text-cyan-300']],
    plus: ['Plus', ['border-blue-500', 'text-blue-700', 'dark:text-blue-300']],
    pro: ['Pro', ['border-purple-500', 'text-purple-700', 'dark:text-purple-300']],
    team: ['Team', ['border-amber-500', 'text-amber-700', 'dark:text-amber-300']],
    business: ['Business', ['border-emerald-500', 'text-emerald-700', 'dark:text-emerald-300']],
    enterprise: ['Enterprise', ['border-rose-500', 'text-rose-700', 'dark:text-rose-300']],
    edu: ['Edu', ['border-teal-500', 'text-teal-700', 'dark:text-teal-300']],
  };
  const [label, colors] = tiers[plan?.toLowerCase() || ''] || [plan || '未知订阅', ['border-zinc-400', 'text-zinc-600', 'dark:text-zinc-300']];
  return [
    {
      tag: 'div',
      classList: ['flex', 'flex-wrap', 'items-center', 'gap-x-3', 'gap-y-1', 'text-xs', 'text-zinc-600', 'dark:text-zinc-300'],
      children: [
        { tag: 'span', classList: ['break-all'], properties: { textContent: maskAccountEmail(email) } },
        {
          // `h-4` matches the `text-xs` line box of the email text; box-border keeps the 1px border inside it.
          tag: 'span',
          classList: [
            'inline-flex',
            'box-border',
            'h-4',
            'shrink-0',
            'items-center',
            'rounded-full',
            'border',
            'px-2',
            'text-xs',
            'leading-none',
            'font-medium',
            ...colors,
          ],
          properties: { textContent: label },
        },
      ],
    },
    { tag: 'div', classList: ['text-xs', 'text-zinc-500', 'dark:text-zinc-400', 'break-words'], properties: { textContent: runtime } },
  ];
}

/** Head details wrapped in one node, so a refresh can replace the whole block in place. */
export function codexHeadDetailsBlock(email: string, plan: string | undefined, runtime: string): TagElementProps {
  return {
    tag: 'div',
    classList: [CODEX_HEAD_DETAILS_CLASS, 'flex', 'flex-col', 'gap-1', 'min-w-0'],
    children: codexHeaderDetails(email, plan, runtime),
  };
}
