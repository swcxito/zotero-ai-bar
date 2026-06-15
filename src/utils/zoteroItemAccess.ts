/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * zoteroItemAccess.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { getItemFullText, getItemMetadata } from './itemContext';

export type ReadItemResult = {
  itemId: number;
  title?: string;
  itemType?: string;
  abstract?: string;
  authors?: string[];
  fullText?: string;
};

export type GlobItem = {
  itemId: number;
  key: string;
  title: string;
  itemType: string;
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
 * Read a Zotero item's metadata and optionally a slice of its attachment text.
 */
export async function readItemText(
  itemId: number,
  includeFullText?: boolean,
  startOffset?: number,
  endOffset?: number
): Promise<ReadItemResult | { error: string }> {
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

  if (includeFullText) {
    const fullText = await getItemFullText(itemId);
    if (fullText) {
      const start = Math.max(0, startOffset ?? 0);
      const end = endOffset !== undefined ? Math.max(start, endOffset) : undefined;
      result.fullText = end !== undefined ? fullText.slice(start, end) : fullText.slice(start);
    } else {
      result.fullText = '';
    }
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
  const itemType = itemTypeID ? Zotero.ItemTypes.getLocalizedString(itemTypeID) : item.itemType;
  return {
    itemId,
    key: item.key,
    title: (item.getField('title') as string) || '(no title)',
    itemType: itemType || 'unknown',
  };
}
