/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agentTools.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { tool, asSchema } from 'ai';
import type { Session, AgentUserAnswer } from './chatManager';
import { getItemFullText } from '../utils/itemContext';
import { getZoteroItem, readItemText, searchLibraryItems } from '../utils/zoteroItemAccess';
import { grepInText } from '../utils/textSearch';
import { onAgentAskUser } from './chatUI';
import {
  askUserSchema,
  grepSchema,
  readSchema,
  globSchema,
  type AskUserPayload,
  type GrepPayload,
  type ReadPayload,
  type GlobPayload,
} from '../utils/agentSchemas';

export type { AskUserPayload, GrepPayload, ReadPayload, GlobPayload } from '../utils/agentSchemas';

function getSession(options: { experimental_context?: unknown }): Session | undefined {
  return options.experimental_context as Session | undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions with execute functions. The AI SDK executes these
// automatically inside ToolLoopAgent; ask_user pauses the loop until the
// user answers in the chat UI.
// ───────────────────────────────────────────────────────────────────────────

export const askUserTool = tool({
  description:
    'Ask the user one or more clarifying questions. Each question provides 2–5 options and may optionally allow a custom text input below the options.',
  inputSchema: asSchema(askUserSchema),
  execute: async (input: AskUserPayload, options): Promise<AgentUserAnswer[]> => {
    const session = getSession(options);
    if (!session) {
      throw new Error('No session context for ask_user');
    }
    return new Promise<AgentUserAnswer[]>((resolve, reject) => {
      session.pending.userAnswerResolve = resolve;
      session.pending.userAnswerReject = reject;
      onAgentAskUser(session, input);
    });
  },
});

export const grepTool = tool({
  description: 'Search the full text of the current article using a case-insensitive literal or regex pattern.',
  inputSchema: asSchema(grepSchema),
  execute: async (input: GrepPayload, options) => {
    const session = getSession(options);
    if (!session) {
      throw new Error('No session context for grep');
    }
    const itemId = session.itemId;
    if (!itemId) {
      throw new Error('No article is associated with this session.');
    }
    const item = getZoteroItem(itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }
    const fullText = await getItemFullText(itemId);
    if (!fullText) {
      throw new Error('Full text not available for this item.');
    }
    const results = grepInText(fullText, input.pattern, input.useRegex ?? false, input.maxResults ?? 20);
    return { matches: results.length, excerpts: results };
  },
});

export const readTool = tool({
  description: 'Read metadata and optionally a slice of the full text from a Zotero item by itemId.',
  inputSchema: asSchema(readSchema),
  execute: async (input: ReadPayload) => {
    const result = await readItemText(input.itemId, input.includeFullText, input.startOffset, input.endOffset);
    if ('error' in result) {
      throw new Error(result.error);
    }
    return result;
  },
});

export const globTool = tool({
  description: 'Search the Zotero library for items matching the query. Returns itemId, key, title, and itemType.',
  inputSchema: asSchema(globSchema),
  execute: async (input: GlobPayload) => {
    const result = await searchLibraryItems(input.query, {
      itemType: input.itemType,
      tag: input.tag,
      limit: input.limit,
    });
    if ('error' in result) {
      throw new Error(result.error);
    }
    return { items: result };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Tool registry
// ───────────────────────────────────────────────────────────────────────────

export function buildTools() {
  return {
    ask_user: askUserTool,
    grep: grepTool,
    read: readTool,
    glob: globTool,
  };
}
