/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * literatureTools.ts
 *
 * This file is part of Zotero AI Bar.
 */

import type { AddPaperPayload, SearchPapersPayload } from '../utils/agentSchemas';

const CROSSREF_WORKS_URL = 'https://api.crossref.org/works';
const CROSSREF_MAILTO = '120201848+swcxito@users.noreply.github.com';
const CROSSREF_TIMEOUT_MS = 15_000;
const DOWNLOAD_COLLECTION_NAME = 'AI 下载文献';
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

type FetchResponseLike = {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export type CrossrefPaperCandidate = {
  rank: number;
  doi: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  type?: string;
  url?: string;
  similarity: number;
  crossrefScore?: number;
};

export type SearchPapersResult = {
  queryTitle: string;
  candidates: CrossrefPaperCandidate[];
  recommendedDoi?: string;
  highConfidence: boolean;
  requiresConfirmation: boolean;
};

export type PaperAttachmentResult = {
  itemId: number;
  key?: string;
  title: string;
  contentType: string;
  fileExists: boolean;
  isFullText: boolean;
};

export type AddPaperResult = {
  status: 'added';
  itemId: number;
  key?: string;
  title: string;
  doi: string;
  collection: { id: number; key?: string; name: string };
  attachments: PaperAttachmentResult[];
  fullTextDownloaded: boolean;
  warningCode?: 'NO_FULL_TEXT_ATTACHMENT';
  warning?: string;
};

export type DuplicatePaperMatch = {
  itemId: number;
  key?: string;
  title: string;
  doi?: string;
  deleted: boolean;
  matchedBy: 'doi' | 'title';
};

type SearchOptions = {
  fetchImpl?: FetchLike;
  delay?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

export type AddPaperDependencies = {
  getLibraryID(): number;
  getAllItems(libraryID: number): Promise<any[]>;
  ensureCollection(libraryID: number): Promise<{ collection: any; created: boolean }>;
  importByDoi(doi: string, libraryID: number, collectionID: number): Promise<any[]>;
  inspectItemAttachments(item: any): Promise<PaperAttachmentResult[]>;
  canFindFile(item: any): boolean;
  addAvailableFile(item: any): Promise<any>;
  rollback(items: any[], collection: any, collectionCreated: boolean): Promise<void>;
};

export function normalizePaperTitle(title: string): string {
  return (
    title
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join('') ?? ''
  );
}

export function normalizeDoi(value: string): string {
  const trimmed = value.trim();
  try {
    const cleaned = Zotero.Utilities.cleanDOI(trimmed);
    if (cleaned) return cleaned.toLowerCase();
  } catch (_error) {
    // Pure unit tests can run this helper without the Zotero global.
  }
  const match = trimmed.match(/10\.\d{4,9}\/\S+/i);
  return (match?.[0] ?? '').replace(/[).,;:]+$/g, '').toLowerCase();
}

export function titleSimilarity(left: string, right: string): number {
  const a = normalizePaperTitle(left);
  const b = normalizePaperTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      intersection++;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * intersection) / (a.length + b.length - 2);
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value.find((entry) => typeof entry === 'string' && entry.trim());
  return typeof first === 'string' ? first.trim() : undefined;
}

function getCrossrefYear(item: any): number | undefined {
  const parts = item?.published?.['date-parts'];
  const year = Array.isArray(parts) && Array.isArray(parts[0]) ? parts[0][0] : undefined;
  return typeof year === 'number' && Number.isInteger(year) ? year : undefined;
}

function getCrossrefAuthors(item: any): string[] {
  if (!Array.isArray(item?.author)) return [];
  return item.author
    .slice(0, 10)
    .map((author: any) => {
      if (typeof author?.name === 'string') return author.name.trim();
      return [author?.given, author?.family]
        .filter((part) => typeof part === 'string' && part.trim())
        .join(' ')
        .trim();
    })
    .filter(Boolean);
}

export function parseCrossrefResponse(payload: unknown, queryTitle: string, limit = 5): SearchPapersResult {
  const items = (payload as any)?.message?.items;
  if (!Array.isArray(items)) {
    throw new Error('PAPER_SEARCH_FAILED: Crossref returned an invalid response.');
  }

  const candidates = items
    .map((item: any): CrossrefPaperCandidate | undefined => {
      const doi = typeof item?.DOI === 'string' ? normalizeDoi(item.DOI) : '';
      const title = firstString(item?.title);
      if (!doi || !title) return undefined;
      return {
        rank: 0,
        doi,
        title,
        authors: getCrossrefAuthors(item),
        year: getCrossrefYear(item),
        venue: firstString(item?.['container-title']),
        type: typeof item?.type === 'string' ? item.type : undefined,
        url: typeof item?.URL === 'string' ? item.URL : undefined,
        similarity: titleSimilarity(queryTitle, title),
        crossrefScore: typeof item?.score === 'number' ? item.score : undefined,
      };
    })
    .filter((candidate: CrossrefPaperCandidate | undefined): candidate is CrossrefPaperCandidate => Boolean(candidate))
    .sort((a: CrossrefPaperCandidate, b: CrossrefPaperCandidate) => b.similarity - a.similarity || (b.crossrefScore ?? 0) - (a.crossrefScore ?? 0))
    .slice(0, Math.max(1, Math.min(10, limit)))
    .map((candidate: CrossrefPaperCandidate, index: number) => ({ ...candidate, rank: index + 1 }));

  const top = candidates[0];
  const runnerUp = candidates[1];
  const highConfidence = Boolean(
    top &&
    top.similarity >= 0.95 &&
    (!runnerUp || top.similarity - runnerUp.similarity >= 0.08) &&
    !candidates.slice(1).some((item) => item.similarity >= 0.9)
  );

  return {
    queryTitle,
    candidates,
    recommendedDoi: highConfidence ? top?.doi : undefined,
    highConfidence,
    requiresConfirmation: candidates.length > 0 && !highConfidence,
  };
}

function retryDelayMilliseconds(response: FetchResponseLike): number {
  const retryAfter = response.headers?.get('Retry-After');
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  return Number.isFinite(seconds) ? Math.max(0, Math.min(5_000, seconds * 1_000)) : 1_000;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = Zotero.Promise.delay(timeoutMs).then(() => {
    throw new Error(`Crossref request timed out after ${timeoutMs} ms.`);
  });
  return Promise.race([promise, timeout]);
}

export async function searchCrossrefPapers(input: SearchPapersPayload, options: SearchOptions = {}): Promise<SearchPapersResult> {
  const title = input.title.trim();
  const limit = Math.max(1, Math.min(10, input.limit ?? 5));
  const params = new URLSearchParams({
    'query.title': title,
    rows: String(limit),
    select: 'DOI,title,author,published,container-title,type,URL,score',
    mailto: CROSSREF_MAILTO,
  });
  const url = `${CROSSREF_WORKS_URL}?${params.toString()}`;
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const delay = options.delay ?? ((milliseconds: number) => Zotero.Promise.delay(milliseconds));
  const timeoutMs = options.timeoutMs ?? CROSSREF_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let response: FetchResponseLike;
    try {
      response = await withTimeout(fetchImpl(url, { headers: { Accept: 'application/json' } }), timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
      await delay(1_000);
      continue;
    }

    if (response.ok) {
      try {
        return parseCrossrefResponse(await response.json(), title, limit);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('PAPER_SEARCH_FAILED:')) throw error;
        throw new Error(`PAPER_SEARCH_FAILED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }

    lastError = new Error(`Crossref returned HTTP ${response.status}.`);
    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === 1) {
      break;
    }
    await delay(retryDelayMilliseconds(response));
  }

  throw new Error(`PAPER_SEARCH_FAILED: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function itemField(item: any, field: string): string {
  try {
    const value = item?.getField?.(field);
    return typeof value === 'string' ? value : '';
  } catch (_error) {
    return '';
  }
}

function itemExtraField(item: any, field: string): string {
  try {
    const value = item?.getExtraField?.(field);
    return typeof value === 'string' ? value : '';
  } catch (_error) {
    return '';
  }
}

export function findDuplicatePaper(items: any[], doi: string, title: string): DuplicatePaperMatch | undefined {
  const normalizedDoi = normalizeDoi(doi);
  const normalizedTitle = normalizePaperTitle(title);

  for (const item of items) {
    if (!item?.isRegularItem?.() || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) continue;
    const existingDoi = normalizeDoi(itemField(item, 'DOI') || itemExtraField(item, 'DOI'));
    if (normalizedDoi && existingDoi === normalizedDoi) {
      return {
        itemId: item.id,
        key: item.key,
        title: itemField(item, 'title') || '(no title)',
        doi: existingDoi,
        deleted: Boolean(item.deleted),
        matchedBy: 'doi',
      };
    }
  }

  if (!normalizedTitle) return undefined;
  for (const item of items) {
    if (!item?.isRegularItem?.() || item.isAttachment?.() || item.isNote?.() || item.isAnnotation?.()) continue;
    if (normalizePaperTitle(itemField(item, 'title')) === normalizedTitle) {
      const existingDoi = normalizeDoi(itemField(item, 'DOI') || itemExtraField(item, 'DOI'));
      return {
        itemId: item.id,
        key: item.key,
        title: itemField(item, 'title') || '(no title)',
        doi: existingDoi || undefined,
        deleted: Boolean(item.deleted),
        matchedBy: 'title',
      };
    }
  }
  return undefined;
}

export function findDownloadCollection(collections: any[]): any | undefined {
  return collections.find((collection) => collection.name === DOWNLOAD_COLLECTION_NAME);
}

function logLiteratureError(message: string, error: unknown): void {
  try {
    if (typeof ztoolkit !== 'undefined') {
      ztoolkit.log(message, error);
    } else if (typeof Zotero !== 'undefined' && typeof Zotero.logError === 'function') {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    }
  } catch (_loggingError) {
    // Logging must never turn a recoverable attachment failure into an import failure.
  }
}

async function ensureDownloadCollection(libraryID: number): Promise<{ collection: any; created: boolean }> {
  const existing = findDownloadCollection(Zotero.Collections.getByLibrary(libraryID) as any[]);
  if (existing) return { collection: existing, created: false };

  const collection = new Zotero.Collection({ libraryID, name: DOWNLOAD_COLLECTION_NAME });
  await collection.saveTx();
  return { collection, created: true };
}

async function importItemByDoi(doi: string, libraryID: number, collectionID: number): Promise<any[]> {
  const translate = new (Zotero as any).Translate.Search();
  translate.setIdentifier({ DOI: doi });
  const translators = await translate.getTranslators();
  if (!Array.isArray(translators) || !translators.length) {
    throw new Error(`No Zotero translator could resolve DOI ${doi}.`);
  }
  translate.setTranslator(translators);
  return translate.translate({ libraryID, collections: [collectionID], saveAttachments: true });
}

async function inspectAttachments(item: any): Promise<PaperAttachmentResult[]> {
  const attachmentIDs: number[] = item.getAttachments?.() ?? [];
  const attachments = attachmentIDs.length ? ((await Zotero.Items.getAsync(attachmentIDs)) as any[]) : [];
  const results: PaperAttachmentResult[] = [];
  for (const attachment of attachments) {
    let fileExists: boolean;
    try {
      fileExists = Boolean(await attachment.getFilePathAsync?.());
    } catch (_error) {
      fileExists = false;
    }
    const contentType = typeof attachment.attachmentContentType === 'string' ? attachment.attachmentContentType : '';
    results.push({
      itemId: attachment.id,
      key: attachment.key,
      title: itemField(attachment, 'title') || '(no title)',
      contentType,
      fileExists,
      isFullText: fileExists && (attachment.isPDFAttachment?.() || contentType === 'application/epub+zip'),
    });
  }
  return results;
}

async function rollbackCreatedObjects(items: any[], collection: any, collectionCreated: boolean): Promise<void> {
  for (const item of items) {
    try {
      await item.eraseTx();
    } catch (error) {
      logLiteratureError('[literatureTools] Failed to roll back imported item:', error);
    }
  }
  if (!collectionCreated) return;
  try {
    const childItems = collection.getChildItems?.(true, true) ?? [];
    const childCollections = collection.getChildCollections?.(true, true) ?? [];
    if (!childItems.length && !childCollections.length) await collection.eraseTx();
  } catch (error) {
    logLiteratureError('[literatureTools] Failed to roll back download collection:', error);
  }
}

function defaultAddPaperDependencies(): AddPaperDependencies {
  return {
    getLibraryID: () => Zotero.Libraries.userLibraryID,
    getAllItems: async (libraryID) => (await Zotero.Items.getAll(libraryID, true, true)) as any[],
    ensureCollection: ensureDownloadCollection,
    importByDoi: importItemByDoi,
    inspectItemAttachments: inspectAttachments,
    canFindFile: (item) => {
      const attachments = Zotero.Attachments as any;
      return typeof attachments.canFindFileForItem === 'function' ? attachments.canFindFileForItem(item) : attachments.canFindPDFForItem(item);
    },
    addAvailableFile: (item) => Zotero.Attachments.addAvailableFile(item),
    rollback: rollbackCreatedObjects,
  };
}

export async function addPaperToZotero(input: AddPaperPayload, dependencies?: AddPaperDependencies): Promise<AddPaperResult> {
  const deps = dependencies ?? defaultAddPaperDependencies();
  const doi = normalizeDoi(input.doi);
  if (!doi) throw new Error(`INVALID_DOI: ${input.doi}`);
  const libraryID = deps.getLibraryID();
  const existingItems = await deps.getAllItems(libraryID);
  const duplicate = findDuplicatePaper(existingItems, doi, input.title);
  if (duplicate) {
    throw new Error(`DUPLICATE_ITEM: ${JSON.stringify(duplicate)}`);
  }

  const { collection, created: collectionCreated } = await deps.ensureCollection(libraryID);
  let importedItems: any[] = [];
  let item: any;
  try {
    const translatedItems = await deps.importByDoi(doi, libraryID, collection.id);
    if (!Array.isArray(translatedItems)) {
      throw new Error(`Zotero returned an invalid result for DOI ${doi}.`);
    }
    importedItems = translatedItems;
    const regularItems = importedItems.filter((item) => item?.isRegularItem?.() && !item.isAttachment?.());
    if (regularItems.length !== 1) {
      throw new Error(`Zotero returned ${regularItems.length} regular items for DOI ${doi}; expected exactly one.`);
    }
    item = regularItems[0];
    const importedDoi = normalizeDoi(itemField(item, 'DOI') || itemExtraField(item, 'DOI'));
    if (importedDoi && importedDoi !== doi) {
      throw new Error(`Zotero resolved DOI ${doi} to a different DOI (${importedDoi}).`);
    }
  } catch (error) {
    await deps.rollback(importedItems, collection, collectionCreated);
    throw new Error(`PAPER_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  let attachments: PaperAttachmentResult[] = [];
  try {
    attachments = await deps.inspectItemAttachments(item);
  } catch (error) {
    logLiteratureError('[literatureTools] Could not inspect translator attachments:', error);
  }
  if (!attachments.some((attachment) => attachment.isFullText)) {
    try {
      if (deps.canFindFile(item)) {
        await deps.addAvailableFile(item);
      }
    } catch (error) {
      logLiteratureError('[literatureTools] Zotero could not add an available full-text file:', error);
    }
    try {
      attachments = await deps.inspectItemAttachments(item);
    } catch (error) {
      logLiteratureError('[literatureTools] Could not verify attachments after file discovery:', error);
    }
  }

  const fullTextDownloaded = attachments.some((attachment) => attachment.isFullText);
  return {
    status: 'added',
    itemId: item.id,
    key: item.key,
    title: itemField(item, 'title') || input.title,
    doi: normalizeDoi(itemField(item, 'DOI') || itemExtraField(item, 'DOI') || doi) || doi,
    collection: { id: collection.id, key: collection.key, name: collection.name },
    attachments,
    fullTextDownloaded,
    ...(fullTextDownloaded
      ? {}
      : {
          warningCode: 'NO_FULL_TEXT_ATTACHMENT' as const,
          warning: 'The Zotero item was added, but no local PDF or EPUB full-text attachment was downloaded.',
        }),
  };
}
