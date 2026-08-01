import { estimateTextTokens } from '../modules/contextCompaction';
import type { ItemMetadata } from './itemContext';

function splitPages(text: string): string[] {
  if (text.includes('\f')) return text.split('\f');
  const pageSize = 8000;
  const pages: string[] = [];
  for (let start = 0; start < text.length; start += pageSize) pages.push(text.slice(start, start + pageSize));
  return pages;
}

function headingOpenings(text: string): string[] {
  const lines = text.split('\n');
  const results: string[] = [];
  const heading =
    /^(?:\d+(?:\.\d+)*\s+)?(?:abstract|introduction|background|methods?|results?|discussion|conclusions?|references|[A-Z][A-Z\s:-]{4,})$/i;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length > 120 || !heading.test(line)) continue;
    results.push(lines.slice(index, Math.min(lines.length, index + 9)).join('\n'));
  }
  return results;
}

export function createDocumentFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}-${(hash >>> 0).toString(16)}`;
}

export function buildDocumentSnapshot(text: string, metadata: ItemMetadata | undefined, tokenBudget: number): string {
  const pages = splitPages(text);
  const candidates: Array<{ label: string; text: string }> = [];
  if (metadata?.title) candidates.push({ label: 'Title', text: metadata.title });
  if (metadata?.abstract) candidates.push({ label: 'Abstract', text: metadata.abstract });
  for (const pageIndex of [0, 1]) {
    if (pages[pageIndex]) candidates.push({ label: `Opening sample (page ${pageIndex + 1})`, text: pages[pageIndex] });
  }
  for (const opening of headingOpenings(text)) candidates.push({ label: 'Section heading and opening', text: opening });
  for (const pageIndex of [pages.length - 2, pages.length - 1]) {
    if (pageIndex >= 0 && pages[pageIndex]) candidates.push({ label: `Closing sample (page ${pageIndex + 1})`, text: pages[pageIndex] });
  }
  const sampleCount = Math.min(12, pages.length);
  for (let sample = 0; sample < sampleCount; sample++) {
    const pageIndex = sampleCount === 1 ? 0 : Math.round((sample * (pages.length - 1)) / (sampleCount - 1));
    if (pages[pageIndex]) candidates.push({ label: `Uniform page sample (${pageIndex + 1}/${pages.length})`, text: pages[pageIndex] });
  }

  const seen = new Set<string>();
  const sections: string[] = [];
  let usedTokens = 0;
  for (const candidate of candidates) {
    const normalized = candidate.text.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const prefix = `## ${candidate.label}\n`;
    const remaining = tokenBudget - usedTokens - estimateTextTokens(prefix);
    if (remaining <= 0) break;
    let body = normalized;
    if (estimateTextTokens(body) > remaining) {
      const ratio = remaining / Math.max(1, estimateTextTokens(body));
      body = body.slice(0, Math.max(0, Math.floor(body.length * ratio))).trimEnd() + '\n…[snapshot excerpt truncated]';
    }
    sections.push(prefix + body);
    usedTokens += estimateTextTokens(prefix + body);
    if (usedTokens >= tokenBudget) break;
  }
  return sections.join('\n\n');
}
