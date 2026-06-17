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
  multiple: z.boolean().optional().describe('Whether the user can select multiple options.'),
});

export const askUserSchema = z.object({
  questions: z.array(askUserQuestionSchema).min(1).max(5).describe('One or more questions to ask the user.'),
});

export type AskUserPayload = z.infer<typeof askUserSchema>;

export const grepSchema = z.object({
  pattern: z
    .string()
    .describe(
      'Case-insensitive literal or regex pattern to search for in the document. Use this to locate specific sections before reading them in detail with the `read` tool.'
    ),
  itemId: z.number().optional().describe('The Zotero item or attachment ID to search. Omit to search the current document.'),
  useRegex: z.boolean().optional().describe('Treat pattern as a regular expression.'),
  maxResults: z.number().int().min(1).max(50).optional().describe('Maximum number of matching excerpts to return.'),
});

export type GrepPayload = z.infer<typeof grepSchema>;

export const readSchema = z.object({
  itemId: z.number().optional().describe('The Zotero item or attachment ID to read. Omit to use the current document.'),
  pageNumber: z.number().int().min(1).optional().describe('Read a specific page by page number (1-based).'),
  startLine: z.number().int().min(1).optional().describe('Start line number (1-based). Use with endLine to read a line range.'),
  endLine: z.number().int().min(1).optional().describe('End line number (inclusive).'),
  contextLines: z.number().int().min(0).max(10).optional().describe('Context lines to include before and after the target range (default 2).'),
});

export type ReadPayload = z.infer<typeof readSchema>;

export const globSchema = z.object({
  query: z.string().describe('Search query string (title, author, abstract, etc.).'),
  itemType: z.string().optional().describe('Filter by Zotero item type, e.g. journalArticle, book.'),
  tag: z.string().optional().describe('Filter by tag.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(
      'Maximum number of results to return. Use the returned itemId with the `read` tool to inspect the full text or metadata of any result.'
    ),
});

export type GlobPayload = z.infer<typeof globSchema>;

export const treeSchema = z.object({
  rootCollectionKey: z.string().optional().describe('Start from a specific collection key; omit to start from the library root.'),
  depth: z.number().int().min(1).max(5).optional().default(2).describe('Maximum depth of subcollections to traverse (1–5).'),
  includeItems: z.boolean().optional().default(true).describe('Whether to list item titles under leaf collections.'),
  itemLimit: z.number().int().min(1).max(200).optional().default(20).describe('Max items to list per collection when includeItems is true (1–200).'),
});

export type TreePayload = z.infer<typeof treeSchema>;

const meaningSchema = z.object({
  pos: z.string().describe('Part of speech, e.g. "adj.", "n."'),
  meaning: z.string().describe('Meaning'),
});

export const translateSchema = z.object({
  originalText: z.string().describe('The original text being translated.'),
  translatedText: z.string().describe('The translated text.'),
  textType: z
    .enum(['word', 'abbreviation'])
    .describe(
      'Type of the selected text. Use this tool ONLY for single words and abbreviations. For sentences or paragraphs, output the translation directly in your response text.'
    ),
  pronunciation: z.string().optional().describe('IPA pronunciation (for words only).'),
  meaning: meaningSchema.optional().describe('Primary meaning in the current context (for words only).'),
  otherMeanings: z.array(meaningSchema).optional().describe('Other common meanings (for words only).'),
  fullForm: z.string().optional().describe('Full form in English (for abbreviations only).'),
  explanation: z.string().optional().describe('Brief explanation (for abbreviations only).'),
  targetLanguage: z.string().optional().describe('Target language name.'),
});

export const capturePageSchema = z.object({
  pageNumber: z.number().int().min(1).describe('The 1-based page number to capture.'),
  itemId: z.number().int().optional().describe('Zotero item ID. Defaults to the current document.'),
});

export type CapturePagePayload = z.infer<typeof capturePageSchema>;

export type TranslatePayload = z.infer<typeof translateSchema>;
