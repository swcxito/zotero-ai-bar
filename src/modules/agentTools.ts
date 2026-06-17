/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agentTools.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { tool, asSchema } from 'ai';
import type { Session, AgentUserAnswer } from './chatManager';
import { getItemFullText } from '../utils/itemContext';
import { getZoteroItem, readItemText, searchLibraryItems, buildLibraryTree, getItemFullTextByPage } from '../utils/zoteroItemAccess';
import { grepInText } from '../utils/textSearch';
import { onAgentAskUser } from './chatUI';
import { getReaderByTabId } from './tabObserver';
import { capturePageByNumber, getPDFReaderForItem } from './capture';
import {
  askUserSchema,
  grepSchema,
  readSchema,
  globSchema,
  treeSchema,
  translateSchema,
  capturePageSchema,
  type AskUserPayload,
  type GrepPayload,
  type ReadPayload,
  type GlobPayload,
  type TreePayload,
  type TranslatePayload,
  type CapturePagePayload,
} from '../utils/agentSchemas';

export type { AskUserPayload, GrepPayload, ReadPayload, GlobPayload, TreePayload, TranslatePayload, CapturePagePayload } from '../utils/agentSchemas';

function getSession(options: { experimental_context?: unknown }): Session | undefined {
  return options.experimental_context as Session | undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions with execute functions. The AI SDK executes these
// automatically inside ToolLoopAgent; ask_user pauses the loop until the
// user answers in the chat UI.
// ───────────────────────────────────────────────────────────────────────────

export const askUserTool = tool({
  description: 'Ask the user one or more clarifying questions. Each question provides 2–5 options plus a custom text input.',
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

    let fullText: string | undefined;
    let pageTexts: string[] | undefined;

    if (input.includePageNumbers) {
      const pageResult = await getItemFullTextByPage(itemId);
      if (pageResult) {
        fullText = pageResult.fullText;
        pageTexts = pageResult.pageTexts;
      }
    }

    if (!fullText) {
      fullText = await getItemFullText(itemId);
    }
    if (!fullText) {
      throw new Error('Full text not available for this item.');
    }

    const results = grepInText(fullText, input.pattern, input.useRegex ?? false, input.maxResults ?? 20, input.contextLines ?? 2, pageTexts);
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

export const treeTool = tool({
  description:
    'List the hierarchical structure of the Zotero library like the Linux tree command. Returns a formatted text with collection/item metadata in square brackets.',
  inputSchema: asSchema(treeSchema),
  execute: async (input: TreePayload) => {
    const result = await buildLibraryTree({
      rootCollectionKey: input.rootCollectionKey,
      depth: input.depth,
      includeItems: input.includeItems,
      itemLimit: input.itemLimit,
    });
    if (typeof result === 'object' && 'error' in result) {
      throw new Error(result.error);
    }
    return { tree: result };
  },
});

export const translateTool = tool({
  description:
    'Present a translation result to the user in a structured, visually formatted card. Use this tool ONLY for single words and abbreviations. After calling this tool, continue your response with one concise sentence that places the translation back into the original context (e.g., how the word is used in this sentence).',
  inputSchema: asSchema(translateSchema),
  execute: async (input: TranslatePayload) => {
    return input;
  },
});

export const capturePageTool = tool({
  description:
    'Capture a specific page of a PDF as an image and display it in the chat. Use this when the user wants to see a figure, table, or visual content from a document. If no itemId is provided, the current document is used.',
  inputSchema: asSchema(capturePageSchema),
  execute: async (input: CapturePagePayload, options) => {
    const session = getSession(options);
    let reader: _ZoteroTypes.ReaderInstance<'pdf'> | null = null;

    if (input.itemId !== undefined) {
      reader = await getPDFReaderForItem(input.itemId);
    } else if (session) {
      reader = getReaderByTabId(session.id) as _ZoteroTypes.ReaderInstance<'pdf'> | null;
    }

    if (!reader) {
      throw new Error('No PDF reader available for this item. Please open it in the PDF reader first.');
    }

    const result = await capturePageByNumber(reader, input.pageNumber);
    return result;
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Tool registry
// ───────────────────────────────────────────────────────────────────────────

export function buildTools(options?: { imageSupport?: boolean }) {
  const tools: Record<string, any> = {
    ask_user: askUserTool,
    grep: grepTool,
    read: readTool,
    glob: globTool,
    tree: treeTool,
    translate: translateTool,
  };
  if (options?.imageSupport) {
    tools.capture_page = capturePageTool;
  }
  return tools;
}
