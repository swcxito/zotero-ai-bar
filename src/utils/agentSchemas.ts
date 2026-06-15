/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * agentSchemas.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { z } from 'zod';

const askUserQuestionSchema = z.object({
  question: z.string().describe('The clarifying question to ask the user.'),
  options: z.array(z.string()).min(2).max(5).describe('2–5 options for the user to choose from.'),
  allowCustomInput: z.boolean().optional().describe('Whether to show an extra text input below the options.'),
  multiple: z.boolean().optional().describe('Whether the user can select multiple options.'),
});

export const askUserSchema = z.object({
  questions: z.array(askUserQuestionSchema).min(1).max(5).describe('One or more questions to ask the user.'),
});

export type AskUserPayload = z.infer<typeof askUserSchema>;

export const grepSchema = z.object({
  pattern: z.string().describe('Case-insensitive literal or regex pattern to search for.'),
  useRegex: z.boolean().optional().describe('Treat pattern as a regular expression.'),
  maxResults: z.number().int().min(1).max(50).optional().describe('Maximum number of matches to return.'),
});

export type GrepPayload = z.infer<typeof grepSchema>;

export const readSchema = z.object({
  itemId: z.number().describe('The Zotero item ID to read.'),
  includeFullText: z.boolean().optional().describe('Whether to include the full text of the item attachment.'),
  startOffset: z.number().int().min(0).optional().describe('Character offset to start reading from (0-based).'),
  endOffset: z.number().int().min(0).optional().describe('Character offset to stop reading at (exclusive).'),
});

export type ReadPayload = z.infer<typeof readSchema>;

export const globSchema = z.object({
  query: z.string().describe('Search query string (title, author, abstract, etc.).'),
  itemType: z.string().optional().describe('Filter by Zotero item type, e.g. journalArticle, book.'),
  tag: z.string().optional().describe('Filter by tag.'),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum number of results to return.'),
});

export type GlobPayload = z.infer<typeof globSchema>;

export const treeSchema = z.object({
  rootCollectionKey: z.string().optional().describe('Start from a specific collection key; omit to start from the library root.'),
  depth: z.number().int().min(1).max(5).optional().default(2).describe('Maximum depth of subcollections to traverse (1–5).'),
  includeItems: z.boolean().optional().default(true).describe('Whether to list item titles under leaf collections.'),
  itemLimit: z.number().int().min(1).max(200).optional().default(20).describe('Max items to list per collection when includeItems is true (1–200).'),
});

export type TreePayload = z.infer<typeof treeSchema>;
