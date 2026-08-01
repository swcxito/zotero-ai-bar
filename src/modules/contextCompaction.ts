import type { ModelMessage } from 'ai';

export const COMPACTION_SUMMARY_MAX_TOKENS = 4096;
export const COMPACTION_TOOL_OUTPUT_LIMIT = 2000;
export const IMAGE_TOKEN_ESTIMATE = 1200;
export const CHECKPOINT_MARKER = '<context-checkpoint>';

export interface ContextCheckpoint {
  summary: string;
  coveredThroughTurnId?: string;
  createdAt: number;
  recentTail: ModelMessage[];
}

export interface ContextBudget {
  estimatedInputTokens: number;
  outputAllowance: number;
  bufferTokens: number;
  thresholdTokens: number;
  shouldCompact: boolean;
}

export interface CompactionPlan {
  head: ModelMessage[];
  tail: ModelMessage[];
  previousSummary?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

function estimateValueTokens(value: unknown): number {
  if (typeof value === 'string') return estimateTextTokens(value);
  if (value == null) return 0;
  if (Array.isArray(value)) {
    return value.reduce((total, part: any) => {
      if (part?.type === 'image' || part?.type === 'file') return total + IMAGE_TOKEN_ESTIMATE;
      return total + estimateValueTokens(part);
    }, 0);
  }
  if (typeof value === 'object') {
    try {
      return estimateTextTokens(JSON.stringify(value));
    } catch (_error) {
      return 64;
    }
  }
  return estimateTextTokens(String(value));
}

export function estimateMessagesTokens(messages: ModelMessage[], tools?: Record<string, unknown>): number {
  const messageTokens = messages.reduce((total, message: any) => total + 12 + estimateValueTokens(message.content), 0);
  return messageTokens + (tools ? estimateValueTokens(tools) : 0);
}

export function calculateContextBudget(params: {
  messages: ModelMessage[];
  contextLimit?: number;
  outputAllowance?: number;
  tools?: Record<string, unknown>;
}): ContextBudget {
  const contextLimit = params.contextLimit ?? 0;
  const estimatedInputTokens = estimateMessagesTokens(params.messages, params.tools);
  const outputAllowance = Math.max(0, params.outputAllowance ?? 0);
  const bufferTokens = contextLimit > 0 ? clamp(Math.round(contextLimit * 0.15), 4096, 20000) : 0;
  const thresholdTokens = contextLimit > 0 ? Math.max(0, contextLimit - Math.max(outputAllowance, bufferTokens)) : Number.POSITIVE_INFINITY;
  return {
    estimatedInputTokens,
    outputAllowance,
    bufferTokens,
    thresholdTokens,
    shouldCompact: contextLimit > 0 && estimatedInputTokens > thresholdTokens,
  };
}

export function findRoundStarts(messages: ModelMessage[]): number[] {
  const starts: number[] = [];
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].role === 'user') starts.push(index);
  }
  return starts;
}

function extractCheckpointSummary(message: ModelMessage | undefined): string | undefined {
  if (!message || message.role !== 'assistant' || typeof (message as any).content !== 'string') return undefined;
  const content = (message as any).content as string;
  if (!content.startsWith(CHECKPOINT_MARKER)) return undefined;
  return content
    .slice(CHECKPOINT_MARKER.length)
    .replace(/^\s*\n?/, '')
    .replace(/\n?<\/context-checkpoint>\s*$/, '')
    .trim();
}

export function createCheckpointMessage(summary: string): ModelMessage {
  return {
    role: 'assistant',
    content: `${CHECKPOINT_MARKER}\n${summary.trim()}\n</context-checkpoint>`,
  } as ModelMessage;
}

function selectNormalTail(messages: ModelMessage[], roundsToKeep: number): number {
  const starts = findRoundStarts(messages);
  if (!starts.length) return messages.length;
  const lastStart = starts.at(-1)!;
  const currentRoundIsIncomplete = !messages.slice(lastStart + 1).some((message) => message.role === 'assistant');
  const count = clamp(Math.floor(roundsToKeep), 1, 64) + (currentRoundIsIncomplete ? 1 : 0);
  return starts[Math.max(0, starts.length - count)];
}

function selectAgentTail(messages: ModelMessage[], targetTokens: number): number {
  const starts = findRoundStarts(messages);
  if (!starts.length) return messages.length;
  const minimumStartIndex = starts[Math.max(0, starts.length - 2)];
  let keepFrom = minimumStartIndex;
  for (let index = starts.length - 3; index >= 0; index--) {
    const candidate = starts[index];
    if (estimateMessagesTokens(messages.slice(candidate)) > targetTokens) break;
    keepFrom = candidate;
  }
  return keepFrom;
}

export function planContextCompaction(
  messages: ModelMessage[],
  options: { mode: 'normal' | 'full-text' | 'agent'; contextRounds?: number; contextLimit?: number }
): CompactionPlan | undefined {
  const previousSummary = extractCheckpointSummary(messages[0]);
  const source = previousSummary ? messages.slice(1) : messages;
  const tailStart =
    options.mode === 'agent'
      ? selectAgentTail(source, clamp(Math.round((options.contextLimit ?? 64000) * 0.18), 8000, 24000))
      : selectNormalTail(source, options.contextRounds ?? 8);
  if (tailStart <= 0 || tailStart >= source.length) return undefined;
  return { head: source.slice(0, tailStart), tail: source.slice(tailStart), previousSummary };
}

function truncateString(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n…[truncated for compaction]`;
}

function sanitizePart(part: any, toolOutputLimit: number): any {
  if (!part || typeof part !== 'object') return part;
  if (part.type === 'image' || part.type === 'file') return { type: 'text', text: '[media omitted during compaction]' };
  if (part.type === 'tool-result') {
    const output = part.output ?? part.result;
    return {
      ...part,
      ...(part.output !== undefined ? { output: truncateString(typeof output === 'string' ? output : JSON.stringify(output), toolOutputLimit) } : {}),
      ...(part.result !== undefined ? { result: truncateString(typeof output === 'string' ? output : JSON.stringify(output), toolOutputLimit) } : {}),
    };
  }
  return part;
}

export function sanitizeMessagesForCompaction(messages: ModelMessage[], toolOutputLimit = COMPACTION_TOOL_OUTPUT_LIMIT): ModelMessage[] {
  return messages.map((message: any) => {
    if (message.role === 'tool') {
      const serialized = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      return { ...message, content: truncateString(serialized, toolOutputLimit) } as ModelMessage;
    }
    if (Array.isArray(message.content)) {
      return { ...message, content: message.content.map((part: any) => sanitizePart(part, toolOutputLimit)) } as ModelMessage;
    }
    return { ...message } as ModelMessage;
  });
}

export function buildCompactionPrompt(params: { previousSummary?: string; messages: ModelMessage[]; toolOutputLimit?: number }): ModelMessage[] {
  const instructions = `Create a faithful context checkpoint for continuing this conversation. Do not invent facts. Clearly distinguish evidence from inference. Preserve exact Zotero item IDs, page numbers, and line numbers when present. Use these headings:\n- User goal\n- Current task\n- Key findings\n- Evidence and locations\n- Completed work and decisions\n- Failed approaches\n- Unresolved questions\n- Next steps\nBe compact but retain details needed to continue.`;
  const body = JSON.stringify(sanitizeMessagesForCompaction(params.messages, params.toolOutputLimit));
  const previous = params.previousSummary ? `\n\nPrevious checkpoint:\n${params.previousSummary}` : '';
  return [
    { role: 'system', content: instructions },
    { role: 'user', content: `${previous}\n\nNew conversation segment to merge:\n${body}` },
  ] as ModelMessage[];
}

export function isContextOverflowError(error: unknown): boolean {
  const text = String((error as any)?.message ?? error ?? '').toLowerCase();
  return (
    text.includes('context length') ||
    text.includes('context window') ||
    text.includes('maximum context') ||
    text.includes('too many tokens') ||
    text.includes('prompt is too long') ||
    text.includes('request too large')
  );
}
