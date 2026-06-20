/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * zoteroItemAccess.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { getItemFullText, getItemMetadata } from './itemContext';

export type PageTextResult = {
  pageTexts: string[];
  fullText: string;
};

export type ReadItemResult = {
  itemId: number;
  title?: string;
  itemType?: string;
  abstract?: string;
  authors?: string[];
  text?: string;
  page?: number;
  lineRange?: { start: number; end: number };
  targetRange?: { start: number; end: number };
};

export type GlobItem = {
  itemId: number;
  key: string;
  title: string;
  itemType: string;
  attachments?: { id: number; title: string }[];
};

export function getZoteroItem(itemId: number): any | undefined {
  try {
    const item = Zotero.Items.get(itemId);
    return item || undefined;
  } catch (e) {
    ztoolkit.log('getZoteroItem failed:', e);
    return undefined;
  }
}

/**
 * Get per-page full text for a PDF attachment using PDFWorker.
 * PDFWorker.getFullText returns a single string with pages separated by `\f` (form feed).
 * We split on `\f` to get per-page text and replace `\f` with `\n` in the searchable full text.
 */
export async function getItemFullTextByPage(itemId: number): Promise<PageTextResult | undefined> {
  try {
    const item = Zotero.Items.get(itemId);
    if (!item) return undefined;

    let attachmentId = itemId;
    if (item.isRegularItem?.() && !item.isAttachment?.()) {
      const attachmentIDs: number[] = item.getAttachments?.() ?? [];
      const pdfAtt = attachmentIDs.find((aid) => {
        const att = Zotero.Items.get(aid) as any;
        return att?.attachmentContentType === 'application/pdf';
      });
      if (pdfAtt === undefined) return undefined;
      attachmentId = pdfAtt;
    }

    const attachment = Zotero.Items.get(attachmentId) as any;
    if (!attachment || attachment.attachmentContentType !== 'application/pdf') return undefined;

    if (typeof Zotero.PDFWorker?.getFullText !== 'function') return undefined;

    const result = await Zotero.PDFWorker.getFullText(attachmentId);
    if (!result?.text || typeof result.text !== 'string') return undefined;

    const pageTexts = result.text.split('\f');
    const fullText = result.text.replace(/\f/g, '\n');
    return { pageTexts, fullText };
  } catch (e) {
    ztoolkit.log('getItemFullTextByPage failed:', e);
    return undefined;
  }
}

function formatLines(lines: string[], start: number, end: number, targetStart?: number, targetEnd?: number, lineOffset: number = 0): string {
  const maxWidth = String(lineOffset + end).length;
  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    const lineNum = String(lineOffset + i + 1).padStart(maxWidth, ' ');
    const inTarget = targetStart !== undefined && targetEnd !== undefined && i >= targetStart && i < targetEnd;
    parts.push(`${inTarget ? '>' : ' '} ${lineNum} | ${lines[i]}`);
  }
  return parts.join('\n');
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
): Promise<ReadItemResult | { error: string }> {
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
    let targetItemId = itemId;

    // Resolve parent item to its PDF attachment
    if (item.isRegularItem?.() && !item.isAttachment?.()) {
      const attachmentIDs: number[] = item.getAttachments?.() ?? [];
      const pdfAttachments = attachmentIDs.filter((aid) => {
        const att = Zotero.Items.get(aid) as any;
        return att?.attachmentContentType === 'application/pdf';
      });
      if (pdfAttachments.length === 0) {
        return { error: `No PDF attachment found for item ${itemId}` };
      }
      if (pdfAttachments.length > 1) {
        const attachmentList = pdfAttachments
          .map((aid) => {
            const att = Zotero.Items.get(aid) as any;
            const title = (att.getField('title') as string) || '(no title)';
            return `  - ${title} (attachment ID: ${aid})`;
          })
          .join('\n');
        return {
          error: `Item ${itemId} has ${pdfAttachments.length} PDF attachments. Please specify which attachment to read by providing the attachment ID directly.\nAvailable PDF attachments:\n${attachmentList}`,
        };
      }
      targetItemId = pdfAttachments[0];
    } else if (!item.isAttachment?.()) {
      return { error: `Item ${itemId} is not a readable attachment or parent item.` };
    }

    const pageResult = await getItemFullTextByPage(targetItemId);
    if (!pageResult) {
      return { error: `Full text not available for item ${targetItemId}` };
    }

    // Page-based reading
    if (pageNumber !== undefined) {
      if (pageNumber < 1 || pageNumber > pageResult.pageTexts.length) {
        return { error: `Page ${pageNumber} is out of range (1-${pageResult.pageTexts.length})` };
      }
      const pageText = pageResult.pageTexts[pageNumber - 1];
      const lines = pageText.split('\n');

      let lineOffset = 0;
      for (let p = 0; p < pageNumber - 1; p++) {
        lineOffset += pageResult.pageTexts[p].split('\n').length;
      }

      result.text = formatLines(lines, 0, lines.length, undefined, undefined, lineOffset);
      result.page = pageNumber;
      result.lineRange = { start: lineOffset + 1, end: lineOffset + lines.length };
      result.targetRange = { start: lineOffset + 1, end: lineOffset + lines.length };
      return result;
    }

    // Line-based reading
    const allLines = pageResult.fullText.split('\n');
    const targetStart = Math.max(0, (startLine ?? 1) - 1);
    const targetEnd = endLine !== undefined ? Math.min(allLines.length, endLine) : targetStart + 1;
    if (targetStart >= allLines.length) {
      return { error: `Start line ${startLine} is out of range (1-${allLines.length})` };
    }

    const ctx = Math.max(0, Math.min(10, contextLines ?? 2));
    const readStart = Math.max(0, targetStart - ctx);
    const readEnd = Math.min(allLines.length, targetEnd + ctx);

    result.text = formatLines(allLines, readStart, readEnd, targetStart, targetEnd);
    result.lineRange = { start: readStart + 1, end: readEnd };
    result.targetRange = { start: targetStart + 1, end: targetEnd };
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
      const haystack = [
        item.getField('title'),
        item.getField('abstractNote'),
        (item.getCreators?.() || []).map((c: any) => `${c.firstName || ''} ${c.lastName || ''} ${c.name || ''}`.trim()).join(' '),
      ]
        .join(' ')
        .toLowerCase();
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
    const attachmentIDs: number[] = item.getAttachments?.() ?? [];
    const attachments = attachmentIDs
      .map((aid) => {
        const att = Zotero.Items.get(aid) as any;
        if (!att) return undefined;
        const title = (att.getField('title') as string) || '(no title)';
        return { id: aid, title };
      })
      .filter((a): a is { id: number; title: string } => a !== undefined);
    if (attachments.length > 1) {
      result.attachments = attachments;
    }
  }

  return result;
}

export type TreeOptions = {
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

    if (options.rootCollectionKey) {
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

    if (includeItems && rootId === undefined) {
      await renderRootItemLines(libraryID, '', itemLimit, lines);
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
    let count = Array.isArray(ownItems) ? ownItems.length : 0;
    if (!Array.isArray(ownItems)) {
      ztoolkit.log('[tree] getChildItems/getAll did not return an array for', collectionId ?? 'root', raw);
    }
    const children =
      collectionId !== undefined ? (Zotero.Collections.getByParent(collectionId) as any[]) : (Zotero.Collections.getByLibrary(libraryID) as any[]);
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
    const items = (Array.isArray(awaited) ? awaited : []) as any[];
    if (!Array.isArray(awaited)) {
      ztoolkit.log('[tree] getChildItems did not return array for collection', collectionId, awaited);
    }
    const sliced = items.slice(0, itemLimit);
    for (let i = 0; i < sliced.length; i++) {
      try {
        const isLast = i === sliced.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        const rawItem = sliced[i];
        const item = typeof rawItem === 'number' ? Zotero.Items.get(rawItem) : rawItem;
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
        if (item && (!item.getCollections || item.getCollections().length === 0)) {
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
