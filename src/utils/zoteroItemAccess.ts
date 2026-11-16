/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * zoteroItemAccess.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { getItemFullText, getItemMetadata } from './itemContext';
import { attachmentSource, itemAttachments, resolveAttachment, AttachmentSelectionError, getItem, creatorNames } from './attachments';
import { compileSearchPattern, grepInTextPaginated, type GrepMatch } from './textSearch';

export type PageTextResult = {
  pageTexts: string[];
  fullText: string;
  /** fullText.split('\n'), precomputed so callers never re-split. */
  lines: string[];
  /** 0-based line number -> 1-based page number, built in one pass at extraction. */
  lineToPage: Map<number, number>;
  /** Line count per page; pageLineCounts[i] = number of '\n'-lines in pageTexts[i]. */
  pageLineCounts: number[];
};

export type ReadItemResult = Partial<ReturnType<typeof attachmentSource>> & {
  itemId: number;
  title?: string;
  itemType?: string;
  abstract?: string;
  authors?: string[];
  text?: string;
  page?: number;
  lineRange?: { start: number; end: number };
  targetRange?: { start: number; end: number };
  truncated?: boolean;
  nextStartLine?: number;
};

export type GlobItem = {
  itemId: number;
  key: string;
  title: string;
  itemType: string;
  attachments?: { id: number; title: string }[];
};

export function getZoteroItem(itemId: number): any | undefined {
  return getItem(itemId);
}

/** Read the library selection at tool-call time, including when chat has focus. */
export function getSelectedLibraryItems(options: { offset?: number; limit?: number } = {}) {
  // ZoteroPane.getSelectedItems() follows the active reader tab instead of the library list.
  const itemsView = Zotero.getMainWindow()?.ZoteroPane?.itemsView;
  if (!itemsView || typeof itemsView.getSelectedItems !== 'function') {
    throw new Error('The Zotero library pane is unavailable. Open the main Zotero window and select literature items.');
  }

  const selectedItems = itemsView.getSelectedItems();
  const uniqueItems = new Map<number, any>();
  for (const selected of selectedItems) {
    const item = selected.isAttachment?.() && selected.parentID ? getZoteroItem(selected.parentID) : selected;
    if (!item || item.deleted || item.isNote?.() || item.isAnnotation?.()) continue;
    if (!item.isRegularItem?.() && !item.isAttachment?.()) continue;
    uniqueItems.set(item.id, item);
  }

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const items = [...uniqueItems.values()].slice(offset, offset + limit).map((item) => ({
    ...getItemMetadata(item.id),
    ...itemToGlobItem(item.id),
  }));
  const total = uniqueItems.size;
  const remaining = Math.max(0, total - offset - items.length);
  return {
    items,
    selectedCount: selectedItems.length,
    total,
    truncated: remaining > 0,
    nextOffset: remaining > 0 ? offset + items.length : undefined,
    remaining,
  };
}

/**
 * Build a PageTextResult (pageTexts, fullText, and all precomputed line
 * structures) from raw PDF text where pages are separated by `\f` (form feed).
 *
 * All derived structures are computed once here so grep/read never re-split.
 */
function buildPageTextResult(rawText: string): PageTextResult {
  const pageTexts = rawText.split('\f');
  const fullText = rawText.replace(/\f/g, '\n');
  const lines = fullText.split('\n');

  // Per-page line count and 0-based line -> 1-based page map, one pass.
  // pageTexts[p].split('\n').length equals the number of '\n'-separated lines
  // that page contributes to fullText (the `\f` becomes one of those newlines).
  const pageLineCounts: number[] = new Array(pageTexts.length);
  const lineToPage = new Map<number, number>();
  let lineIdx = 0;
  for (let p = 0; p < pageTexts.length && lineIdx < lines.length; p++) {
    const pageLineCount = pageTexts[p].split('\n').length;
    pageLineCounts[p] = pageLineCount;
    for (let j = 0; j < pageLineCount && lineIdx < lines.length; j++) {
      lineToPage.set(lineIdx, p + 1);
      lineIdx++;
    }
  }

  return { pageTexts, fullText, lines, lineToPage, pageLineCounts };
}

/**
 * Get per-page full text for a PDF attachment.
 *
 * Pages in the source text are separated by `\f` (form feed). We prefer the
 * `.zotero-ft-cache` file Zotero writes after indexing - it is byte-identical
 * to `PDFWorker.getFullText` output (verified) but avoids re-parsing the PDF
 * on every call, which is the dominant cost for long documents. Falls back to
 * `PDFWorker.getFullText` when no cache file exists (e.g. un-indexed item).
 */
export async function getItemFullTextByPage(itemId: number): Promise<PageTextResult | undefined> {
  try {
    const attachment = resolveAttachment(itemId, 'pdf');
    if (!attachment) return undefined;
    const attachmentId = attachment.id;

    // 1) Prefer the indexed full-text cache file (instant, no PDF parse).
    const FT: any = (Zotero as any).FullText ?? (Zotero as any).Fulltext;
    if (FT && typeof FT.getItemCacheFile === 'function') {
      try {
        const cacheFile = FT.getItemCacheFile(attachment);
        if (cacheFile?.exists?.()) {
          const cacheText = await (Zotero as any).File.getContentsAsync(cacheFile);
          if (typeof cacheText === 'string' && cacheText.length > 0) {
            return buildPageTextResult(cacheText);
          }
        }
      } catch (cacheErr) {
        ztoolkit.log('getItemFullTextByPage cache read failed, falling back to PDFWorker:', cacheErr);
      }
    }

    // 2) Fallback: extract on demand (today's behavior).
    if (typeof Zotero.PDFWorker?.getFullText !== 'function') return undefined;
    const result = await Zotero.PDFWorker.getFullText(attachmentId);
    if (!result?.text || typeof result.text !== 'string') return undefined;
    return buildPageTextResult(result.text);
  } catch (e) {
    if (e instanceof AttachmentSelectionError) throw e;
    ztoolkit.log('getItemFullTextByPage failed:', e);
    return undefined;
  }
}

const MAX_READ_LINES = 5000;
const MAX_READ_CHARS = 250000;

/** Paginate one stable stream of matches across the selected item's attachments. */
export async function searchItemAttachments(itemId: number, pattern: string, useRegex = true, maxResults = 50, offset = 0, signal?: AbortSignal) {
  if (useRegex) compileSearchPattern(pattern);
  const limit = Math.max(1, Math.min(500, Math.floor(maxResults)));
  const start = Math.max(0, Math.floor(offset));
  const excerpts: Array<GrepMatch & ReturnType<typeof attachmentSource>> = [];
  const unreadableAttachments: Array<ReturnType<typeof attachmentSource> & { error: string }> = [];
  let totalMatches = 0;
  let outputChars = 0;
  let saturated = false;
  for (const attachment of itemAttachments(itemId)) {
    signal?.throwIfAborted();
    const source = attachmentSource(attachment);
    try {
      const pages = await getItemFullTextByPage(attachment.id);
      const text = pages?.fullText ?? (await getItemFullText(attachment.id));
      signal?.throwIfAborted();
      if (!text) throw new Error('Full text unavailable or unsupported attachment format.');
      const result = grepInTextPaginated(
        text,
        pattern,
        useRegex,
        Math.max(1, limit - excerpts.length),
        Math.max(0, start - totalMatches),
        pages?.pageTexts,
        {
          lines: pages?.lines,
          lineToPage: pages?.lineToPage,
        }
      );
      if (!saturated && excerpts.length < limit) {
        for (const match of result.excerpts) {
          if (outputChars + match.excerpt.length > MAX_READ_CHARS) {
            saturated = true;
            break;
          }
          excerpts.push({ ...match, ...source });
          outputChars += match.excerpt.length;
        }
      }
      totalMatches += result.totalMatches;
    } catch (error) {
      signal?.throwIfAborted();
      unreadableAttachments.push({ ...source, error: String((error as Error).message ?? error) });
    }
  }
  const remaining = Math.max(0, totalMatches - start - excerpts.length);
  return {
    matches: excerpts.length,
    totalMatches,
    excerpts,
    truncated: remaining > 0,
    nextOffset: remaining ? start + excerpts.length : undefined,
    remaining,
    unreadableAttachments,
  };
}

export function formatLinesLimited(
  lines: string[],
  start: number,
  end: number,
  targetStart?: number,
  targetEnd?: number,
  lineOffset: number = 0
): { text: string; end: number; truncated: boolean } {
  const cappedEnd = Math.min(end, start + MAX_READ_LINES);
  const maxWidth = String(lineOffset + cappedEnd).length;
  const parts: string[] = [];
  let chars = 0;
  let actualEnd = start;
  for (let index = start; index < cappedEnd; index++) {
    const lineNum = String(lineOffset + index + 1).padStart(maxWidth, ' ');
    const inTarget = targetStart !== undefined && targetEnd !== undefined && index >= targetStart && index < targetEnd;
    const row = `${inTarget ? '>' : ' '} ${lineNum} | ${lines[index]}`;
    const separator = parts.length ? 1 : 0;
    if (chars + separator + row.length > MAX_READ_CHARS) {
      if (!parts.length) {
        parts.push(row.slice(0, MAX_READ_CHARS));
        actualEnd = index + 1;
      }
      break;
    }
    parts.push(row);
    chars += separator + row.length;
    actualEnd = index + 1;
  }
  return { text: parts.join('\n'), end: actualEnd, truncated: actualEnd < end };
}

/**
 * Read a Zotero item's metadata and optionally a slice of its attachment text.
 * Supports line-based and page-based reading with context lines.
 */
export async function readItemText(
  itemId: number | undefined,
  pageNumber?: number,
  startLine?: number,
  endLine?: number,
  contextLines?: number
): Promise<ReadItemResult | { error: string; candidates?: ReturnType<typeof attachmentSource>[] }> {
  if (!itemId) {
    return { error: 'No item ID provided.' };
  }
  const item = getZoteroItem(itemId);
  if (!item) {
    return { error: `Item not found: ${itemId}` };
  }

  const metadata = getItemMetadata(itemId);
  const result: ReadItemResult = {
    itemId,
    title: metadata?.title,
    itemType: metadata?.itemType,
    abstract: metadata?.abstract,
    authors: metadata?.authors,
  };

  // Only read text if any reading param is provided
  if (pageNumber !== undefined || startLine !== undefined || endLine !== undefined) {
    let attachment: Zotero.Item | undefined;
    try {
      attachment = resolveAttachment(itemId, pageNumber === undefined ? 'text' : 'pdf');
    } catch (error) {
      if (error instanceof AttachmentSelectionError) return { error: error.message, candidates: error.candidates };
      throw error;
    }
    if (!attachment) return { error: `No readable attachment found for item ${itemId}` };
    const targetItemId = attachment.id;
    Object.assign(result, attachmentSource(attachment), { itemId: targetItemId });
    const pdfResult = await getItemFullTextByPage(targetItemId);
    const fullText = pdfResult?.fullText ?? (await getItemFullText(targetItemId));
    if (!fullText) return { error: `Full text not available for item ${targetItemId}` };
    const pageResult = pdfResult ?? { pageTexts: [], fullText, lines: fullText.split('\n'), pageLineCounts: [] };

    // Page-based reading
    if (pageNumber !== undefined) {
      if (pageNumber < 1 || pageNumber > pageResult.pageTexts.length) {
        return { error: `Page ${pageNumber} is out of range (1-${pageResult.pageTexts.length})` };
      }
      const pageText = pageResult.pageTexts[pageNumber - 1];
      const lines = pageText.split('\n');

      // Global line offset of this page's first line, via precomputed
      // per-page line counts (avoids re-splitting every preceding page).
      let lineOffset = 0;
      for (let p = 0; p < pageNumber - 1; p++) {
        lineOffset += pageResult.pageLineCounts[p] ?? pageResult.pageTexts[p].split('\n').length;
      }

      const formatted = formatLinesLimited(lines, 0, lines.length, undefined, undefined, lineOffset);
      result.text = formatted.text;
      result.page = pageNumber;
      result.lineRange = { start: lineOffset + 1, end: lineOffset + formatted.end };
      result.targetRange = { start: lineOffset + 1, end: lineOffset + formatted.end };
      result.truncated = formatted.truncated;
      result.nextStartLine = formatted.truncated ? lineOffset + formatted.end + 1 : undefined;
      return result;
    }

    // Line-based reading (uses precomputed lines - no re-split).
    const allLines = pageResult.lines;
    const targetStart = Math.max(0, (startLine ?? 1) - 1);
    const requestedTargetEnd = endLine !== undefined ? Math.min(allLines.length, endLine) : targetStart + 1;
    const targetEnd = Math.min(requestedTargetEnd, targetStart + MAX_READ_LINES);
    if (targetStart >= allLines.length) {
      return { error: `Start line ${startLine} is out of range (1-${allLines.length})` };
    }

    const ctx = Math.max(0, Math.min(10, contextLines ?? 2));
    const readStart = Math.max(0, targetStart - ctx);
    const readEnd = Math.min(allLines.length, targetEnd + ctx);

    const formatted = formatLinesLimited(allLines, readStart, readEnd, targetStart, targetEnd);
    result.text = formatted.text;
    result.lineRange = { start: readStart + 1, end: formatted.end };
    result.targetRange = { start: targetStart + 1, end: Math.min(targetEnd, formatted.end) };
    result.truncated = formatted.truncated || targetEnd < requestedTargetEnd;
    result.nextStartLine = result.truncated ? Math.max(targetStart + 1, formatted.end + 1) : undefined;
  }

  return result;
}

/**
 * Search the Zotero library for items matching the query.
 * Falls back to a simple title/author/abstract scan if Zotero.Search is unavailable.
 */
export async function searchLibraryItems(
  query: string,
  options: { itemType?: string; tag?: string; limit?: number } = {}
): Promise<GlobItem[] | { error: string }> {
  try {
    const limit = Math.max(1, Math.min(50, options.limit ?? 20));
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return { error: 'Query cannot be empty.' };
    }

    // Try to use Zotero.Search when available
    if (typeof Zotero.Search === 'function') {
      const search = new Zotero.Search();
      search.addCondition('quicksearch-titleCreatorYear', 'contains', query);
      if (options.itemType) {
        search.addCondition('itemType', 'is', options.itemType);
      }
      if (options.tag) {
        search.addCondition('tag', 'is', options.tag);
      }
      const ids: number[] = (await search.search()) || [];
      return ids.slice(0, limit).map((id) => itemToGlobItem(id));
    }

    // Fallback: scan regular items in the user library
    const libraryID = Zotero.Libraries?.userLibraryID;
    const allItems = libraryID !== undefined ? Zotero.Items.getAll(libraryID, true) : [];
    const matches: GlobItem[] = [];
    for (const item of allItems as any[]) {
      if (!item.isRegularItem?.()) {
        continue;
      }
      if (options.itemType && item.itemType !== options.itemType) {
        continue;
      }
      const haystack = [item.getField('title'), item.getField('abstractNote'), creatorNames(item).join(' ')].join(' ').toLowerCase();
      if (haystack.includes(normalizedQuery)) {
        matches.push(itemToGlobItem(item.id));
        if (matches.length >= limit) {
          break;
        }
      }
    }
    return matches;
  } catch (e) {
    ztoolkit.log('searchLibraryItems failed:', e);
    return { error: `Search failed: ${String(e)}` };
  }
}

function itemToGlobItem(itemId: number): GlobItem {
  const item = Zotero.Items.get(itemId) as any;
  const itemTypeID = item.itemTypeID;
  const itemType = itemTypeID ? Zotero.ItemTypes.getName(itemTypeID) : item.itemType;
  const result: GlobItem = {
    itemId,
    key: item.key,
    title: (item.getField('title') as string) || '(no title)',
    itemType: itemType || 'unknown',
  };

  if (item.isRegularItem?.() && !item.isAttachment?.()) {
    const attachments = itemAttachments(itemId).map((attachment) => ({ id: attachment.id, title: attachmentSource(attachment).attachmentTitle }));
    if (attachments.length > 1) {
      result.attachments = attachments;
    }
  }

  return result;
}

export type TreeOptions = {
  rootCollectionPath?: string[];
  rootCollectionKey?: string;
  depth?: number;
  includeItems?: boolean;
  itemLimit?: number;
};

/**
 * Build a Linux-tree-style string of the Zotero library collection structure.
 * Metadata is appended in square brackets after each node name.
 */
export async function buildLibraryTree(options: TreeOptions = {}): Promise<string | { error: string }> {
  try {
    const depth = Math.max(1, Math.min(5, options.depth ?? 2));
    const includeItems = options.includeItems ?? true;
    const itemLimit = Math.max(1, Math.min(200, options.itemLimit ?? 20));

    const libraryID = Zotero.Libraries?.userLibraryID;
    if (libraryID === undefined) {
      return { error: 'No user library available.' };
    }

    let rootCollection: any | undefined;
    let rootName: string;
    let rootType: 'library' | 'collection' = 'library';
    let rootId: number | undefined;

    if (options.rootCollectionPath?.length) {
      const resolved = resolveCollectionByPath(options.rootCollectionPath, libraryID);
      if (resolved.error || !resolved.collection) {
        return { error: resolved.error || `Collection not found: ${options.rootCollectionPath.join(' > ')}` };
      }
      rootCollection = resolved.collection;
      rootName = rootCollection.name;
      rootType = 'collection';
      rootId = rootCollection.id;
    } else if (options.rootCollectionKey) {
      rootCollection = resolveCollectionByKey(options.rootCollectionKey, libraryID);
      if (!rootCollection) {
        return { error: `Collection not found: ${options.rootCollectionKey}` };
      }
      rootName = rootCollection.name;
      rootType = 'collection';
      rootId = rootCollection.id;
    } else {
      const library = Zotero.Libraries.get(libraryID) as any;
      rootName = library?.name || 'My Library';
      rootId = undefined;
    }

    const lines: string[] = [];
    const rootItemCount = await countItemsRecursive(rootId, libraryID);
    lines.push(`${rootName} [${rootType}, ${rootItemCount} items]`);

    const childCollections = rootId !== undefined ? Zotero.Collections.getByParent(rootId) : Zotero.Collections.getByLibrary(libraryID);

    await renderTreeLines(childCollections as any[], libraryID, '', depth, 1, includeItems, itemLimit, lines);

    if (includeItems) {
      if (rootId === undefined) {
        await renderRootItemLines(libraryID, '', itemLimit, lines);
      } else {
        // A collection used as the root can also contain direct items. They
        // are not part of childCollections, so render them explicitly.
        await renderItemLines(rootId, '', itemLimit, lines);
      }
    }

    return lines.join('\n');
  } catch (e) {
    ztoolkit.log('buildLibraryTree failed:', e);
    return { error: `Tree failed: ${String(e)}` };
  }
}

function resolveCollectionByKey(key: string, libraryID: number): any | undefined {
  try {
    if (typeof Zotero.Collections.getByLibraryAndKey === 'function') {
      return Zotero.Collections.getByLibraryAndKey(libraryID, key);
    }
    const collections = Zotero.Collections.getByLibrary(libraryID) as any[];
    return collections.find((c) => c.key === key);
  } catch (e) {
    ztoolkit.log('resolveCollectionByKey failed:', e);
    return undefined;
  }
}

function resolveCollectionByPath(path: string[], libraryID: number): { collection?: any; error?: string } {
  try {
    const segments = path.map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      return { error: 'Collection path cannot be empty.' };
    }

    let candidates = Zotero.Collections.getByLibrary(libraryID) as any[];
    let parentName = 'library root';

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const matches = candidates.filter((collection) => collection?.name === segment);
      if (matches.length === 0) {
        return { error: `Collection not found under ${parentName}: ${segment}` };
      }
      if (matches.length > 1) {
        return { error: `Collection path is ambiguous under ${parentName}: ${segment}` };
      }

      const collection = matches[0];
      parentName = segments.slice(0, index + 1).join(' > ');
      candidates = Zotero.Collections.getByParent(collection.id) as any[];

      if (index === segments.length - 1) {
        return { collection };
      }
    }

    return { error: `Collection not found: ${segments.join(' > ')}` };
  } catch (e) {
    ztoolkit.log('resolveCollectionByPath failed:', e);
    return { error: `Failed to resolve collection path: ${segmentsForError(path)}` };
  }
}

function segmentsForError(path: string[]): string {
  return path.join(' > ') || '(empty)';
}

export function isValidTreeItem(item: any): boolean {
  if (!item || !item.isRegularItem?.() || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) return false;
  const authors = creatorNames(item).join(' ');
  const fields = ['title', 'date', 'publicationTitle', 'proceedingsTitle', 'publisher', 'abstractNote'];
  return Boolean(authors || fields.some((field) => String(item.getField?.(field) ?? '').trim()));
}

function filterValidTreeItems(rawItems: any[]): any[] {
  const result: any[] = [];
  for (const rawItem of rawItems) {
    try {
      const item = typeof rawItem === 'number' ? Zotero.Items.get(rawItem) : rawItem;
      if (isValidTreeItem(item)) result.push(item);
    } catch (error) {
      ztoolkit.log('[tree] failed to resolve item:', error);
    }
  }
  return result;
}

async function countItemsRecursive(collectionId: number | undefined, libraryID: number): Promise<number> {
  try {
    let ownItems: any[];
    let raw: any;
    if (collectionId !== undefined) {
      const collection = Zotero.Collections.get(collectionId);
      raw = collection?.getChildItems?.(true);
      ownItems = (Array.isArray(raw) ? raw : await raw) as any[];
    } else {
      raw = Zotero.Items.getAll(libraryID, true);
      ownItems = (Array.isArray(raw) ? raw : await raw) as any[];
    }
    let count = Array.isArray(ownItems) ? filterValidTreeItems(ownItems).length : 0;
    if (!Array.isArray(ownItems)) {
      ztoolkit.log('[tree] getChildItems/getAll did not return an array for', collectionId ?? 'root', raw);
    }
    if (collectionId === undefined) return count;
    const children = Zotero.Collections.getByParent(collectionId) as any[];
    for (const child of children) {
      count += await countItemsRecursive(child.id, libraryID);
    }
    return count;
  } catch (e) {
    ztoolkit.log('countItemsRecursive failed:', e);
    return 0;
  }
}

async function renderTreeLines(
  collections: any[],
  libraryID: number,
  prefix: string,
  maxDepth: number,
  currentDepth: number,
  includeItems: boolean,
  itemLimit: number,
  lines: string[]
): Promise<void> {
  for (let i = 0; i < collections.length; i++) {
    const isLast = i === collections.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const collection = collections[i];
    const itemCount = await countItemsRecursive(collection.id, libraryID);
    lines.push(`${prefix}${branch}${collection.name} [collection, ${itemCount} items]`);

    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    if (currentDepth < maxDepth) {
      const children = Zotero.Collections.getByParent(collection.id) as any[];
      if (children.length > 0) {
        await renderTreeLines(children, libraryID, childPrefix, maxDepth, currentDepth + 1, includeItems, itemLimit, lines);
      }
    }

    if (includeItems) {
      await renderItemLines(collection.id, childPrefix, itemLimit, lines);
    }
  }
}

async function renderItemLines(collectionId: number, prefix: string, itemLimit: number, lines: string[]): Promise<void> {
  try {
    const collection = Zotero.Collections.get(collectionId);
    const raw = collection?.getChildItems?.(true) as any;
    const awaited = Array.isArray(raw) ? raw : await raw;
    const items = filterValidTreeItems((Array.isArray(awaited) ? awaited : []) as any[]);
    if (!Array.isArray(awaited)) {
      ztoolkit.log('[tree] getChildItems did not return array for collection', collectionId, awaited);
    }
    const sliced = items.slice(0, itemLimit);
    for (let i = 0; i < sliced.length; i++) {
      try {
        const isLast = i === sliced.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        const item = sliced[i];
        if (!item) {
          continue;
        }
        const itemTypeID = item.itemTypeID;
        const itemType = itemTypeID ? Zotero.ItemTypes.getName(itemTypeID) : item.itemType;
        const title = (item.getField('title') as string) || '(no title)';
        lines.push(`${prefix}${branch}${title} [${itemType || 'unknown'}, id: ${item.id}]`);
      } catch (itemErr) {
        ztoolkit.log('[tree] failed to render item line:', itemErr);
      }
    }
    if (items.length > itemLimit) {
      lines.push(`${prefix}└── ... and ${items.length - itemLimit} more items`);
    }
  } catch (e) {
    ztoolkit.log('renderItemLines failed:', e);
  }
}

async function renderRootItemLines(libraryID: number, prefix: string, itemLimit: number, lines: string[]): Promise<void> {
  try {
    const raw = Zotero.Items.getAll(libraryID, true) as any;
    const allItems = (Array.isArray(raw) ? raw : await raw) as any[];
    if (!Array.isArray(allItems)) {
      ztoolkit.log('[tree] getAll did not return array for root', raw);
      return;
    }
    const items: any[] = [];
    for (const rawItem of allItems) {
      try {
        const item = typeof rawItem === 'number' ? Zotero.Items.get(rawItem) : rawItem;
        if (isValidTreeItem(item) && (!item.getCollections || item.getCollections().length === 0)) {
          items.push(item);
        }
      } catch (itemErr) {
        ztoolkit.log('[tree] failed to resolve root item:', itemErr);
      }
    }
    const sliced = items.slice(0, itemLimit);
    for (let i = 0; i < sliced.length; i++) {
      try {
        const isLast = i === sliced.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        const item = sliced[i];
        const itemTypeID = item.itemTypeID;
        const itemType = itemTypeID ? Zotero.ItemTypes.getName(itemTypeID) : item.itemType;
        const title = (item.getField('title') as string) || '(no title)';
        lines.push(`${prefix}${branch}${title} [${itemType || 'unknown'}, id: ${item.id}]`);
      } catch (itemErr) {
        ztoolkit.log('[tree] failed to render root item line:', itemErr);
      }
    }
    if (items.length > itemLimit) {
      lines.push(`${prefix}└── ... and ${items.length - itemLimit} more items`);
    }
  } catch (e) {
    ztoolkit.log('renderRootItemLines failed:', e);
  }
}
