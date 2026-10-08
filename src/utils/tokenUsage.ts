import type { TokenCounts, TokenUsage } from '../modules/chatManager';
import { getString } from './locale';

export function normalizeTokenCounts(raw: any): TokenCounts {
  const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined);
  const promptTokens = count(raw?.inputTokens) ?? count(raw?.promptTokens);
  const completionTokens = count(raw?.outputTokens) ?? count(raw?.completionTokens);
  const totalTokens =
    count(raw?.totalTokens) ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
  return { promptTokens, completionTokens, totalTokens };
}

export function normalizeUsage(raw: any): TokenUsage {
  const usage: TokenUsage = normalizeTokenCounts(raw);
  if (raw?.cumulative) usage.cumulative = normalizeTokenCounts(raw.cumulative);
  return usage;
}

export function formatTokenCount(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(1) + 'K';
  if (n < 1000000) return Math.round(n / 1000) + 'K';
  return (n / 1000000).toFixed(1) + 'M';
}

export function contextTokenInfo(usage: TokenUsage | undefined, contextLimit?: number): { text: string; title: string } {
  if (!usage) return { text: '', title: '' };
  if (usage.cumulative) {
    const total = usage.cumulative;
    const title = [
      [getString('token-usage-input'), total.promptTokens],
      [getString('token-usage-output'), total.completionTokens],
      [getString('token-usage-total'), total.totalTokens],
    ]
      .filter(([, value]) => typeof value === 'number')
      .map(([label, value]) => `${label}: ${value!.toLocaleString()}`)
      .join(' · ');
    return { text: `${getString('token-usage-cumulative')}: ${formatTokenCount(total.totalTokens)}`, title };
  }
  const contextTokens = usage.totalTokens ?? usage.promptTokens;
  let text = `${getString('token-usage-context')}: ${formatTokenCount(contextTokens)}`;
  if (contextLimit && contextLimit > 0 && contextTokens !== undefined) {
    const pct = Math.min(100, (contextTokens / contextLimit) * 100);
    const pctStr = pct < 1 ? pct.toFixed(1) : Math.round(pct).toString();
    text += ` / ${formatTokenCount(contextLimit)} · ${pctStr}%`;
  }
  const title = contextLimit
    ? `${getString('token-usage-context-window')}: ${contextLimit.toLocaleString()}`
    : getString('token-usage-context-window-unknown');
  return { text, title };
}
