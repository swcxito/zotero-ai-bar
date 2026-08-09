import { assert } from 'chai';
import { buildTools } from '../src/modules/agentTools';
import {
  addPaperToZotero,
  findDownloadCollection,
  findDuplicatePaper,
  normalizePaperTitle,
  parseCrossrefResponse,
  searchCrossrefPapers,
  titleSimilarity,
  type AddPaperDependencies,
  type PaperAttachmentResult,
} from '../src/modules/literatureTools';
import { AGENT_INSTRUCTIONS_PROMPT } from '../src/utils/prompts';

function crossrefItem(doi: string | undefined, title: string | undefined, score = 10) {
  return {
    DOI: doi,
    title: title ? [title] : [],
    author: [{ given: 'Ada', family: 'Lovelace' }],
    published: { 'date-parts': [[2025, 1, 2]] },
    'container-title': ['Test Journal'],
    type: 'journal-article',
    URL: doi ? `https://doi.org/${doi}` : undefined,
    score,
  };
}

function zoteroItem(fields: Record<string, string>, options: { id?: number; deleted?: boolean; extraDoi?: string } = {}) {
  return {
    id: options.id ?? 1,
    key: `KEY${options.id ?? 1}`,
    deleted: options.deleted ?? false,
    isRegularItem: () => true,
    isAttachment: () => false,
    isNote: () => false,
    isAnnotation: () => false,
    getField: (field: string) => fields[field] ?? '',
    getExtraField: (field: string) => (field === 'DOI' ? (options.extraDoi ?? '') : ''),
  };
}

function response(status: number, payload: unknown, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'Retry-After' ? (retryAfter ?? null) : null) },
    json: async () => payload,
  };
}

function addDependencies(overrides: Partial<AddPaperDependencies> = {}): AddPaperDependencies {
  const item = zoteroItem({ title: 'A Paper', DOI: '10.1000/paper' }, { id: 20 });
  return {
    getLibraryID: () => 1,
    getAllItems: async () => [],
    ensureCollection: async () => ({ collection: { id: 7, key: 'COLL', name: 'AI 下载文献' }, created: false }),
    importByDoi: async () => [item],
    inspectItemAttachments: async () => [],
    canFindFile: () => false,
    addAvailableFile: async () => false,
    rollback: async () => undefined,
    ...overrides,
  };
}

describe('literatureTools', function () {
  it('registers both tools and instructs the agent about confirmation and attachment warnings', function () {
    const tools = buildTools();
    assert.containsAllKeys(tools, ['search_papers', 'add_paper']);
    assert.include(AGENT_INSTRUCTIONS_PROMPT, '`search_papers` first');
    assert.include(AGENT_INSTRUCTIONS_PROMPT, '`DUPLICATE_ITEM`');
    assert.include(AGENT_INSTRUCTIONS_PROMPT, '`NO_FULL_TEXT_ATTACHMENT`');
  });

  describe('title matching and Crossref parsing', function () {
    it('normalizes punctuation, case, whitespace, and Unicode width', function () {
      assert.equal(normalizePaperTitle(' Ａ Paper: Test! '), 'apapertest');
      assert.equal(titleSimilarity('A Paper: Test', 'a paper test'), 1);
    });

    it('marks a unique strong title match as high confidence', function () {
      const result = parseCrossrefResponse(
        { message: { items: [crossrefItem('10.1000/exact', 'Exact Paper Title'), crossrefItem('10.1000/other', 'Unrelated Work')] } },
        'Exact Paper Title'
      );
      assert.isTrue(result.highConfidence);
      assert.equal(result.recommendedDoi, '10.1000/exact');
      assert.isFalse(result.requiresConfirmation);
    });

    it('requires confirmation for multiple identical titles with different DOIs', function () {
      const result = parseCrossrefResponse(
        { message: { items: [crossrefItem('10.1000/one', 'Same Title'), crossrefItem('10.1000/two', 'Same Title')] } },
        'Same Title'
      );
      assert.isFalse(result.highConfidence);
      assert.isTrue(result.requiresConfirmation);
      assert.isUndefined(result.recommendedDoi);
    });

    it('drops candidates without a DOI or title and rejects malformed responses', function () {
      const result = parseCrossrefResponse(
        { message: { items: [crossrefItem(undefined, 'No DOI'), crossrefItem('10.1000/no-title', undefined)] } },
        'Missing'
      );
      assert.deepEqual(result.candidates, []);
      assert.throws(() => parseCrossrefResponse({}, 'Missing'), /PAPER_SEARCH_FAILED/);
    });

    it('retries one 429 response and then returns candidates', async function () {
      let calls = 0;
      const delays: number[] = [];
      const result = await searchCrossrefPapers(
        { title: 'Exact Paper Title', limit: 3 },
        {
          fetchImpl: async () => {
            calls++;
            return calls === 1 ? response(429, {}, '0') : response(200, { message: { items: [crossrefItem('10.1000/exact', 'Exact Paper Title')] } });
          },
          delay: async (milliseconds) => {
            delays.push(milliseconds);
          },
        }
      );
      assert.equal(calls, 2);
      assert.deepEqual(delays, [0]);
      assert.equal(result.recommendedDoi, '10.1000/exact');
    });

    it('does not retry a non-retryable HTTP response', async function () {
      let calls = 0;
      let error: unknown;
      try {
        await searchCrossrefPapers(
          { title: 'Paper', limit: 1 },
          {
            fetchImpl: async () => {
              calls++;
              return response(400, {});
            },
            delay: async () => undefined,
          }
        );
      } catch (caught) {
        error = caught;
      }
      assert.equal(calls, 1);
      assert.match(String(error), /PAPER_SEARCH_FAILED.*HTTP 400/);
    });

    it('reports a timeout after the retry is exhausted', async function () {
      let error: unknown;
      try {
        await searchCrossrefPapers(
          { title: 'Paper', limit: 1 },
          {
            fetchImpl: async () => new Promise<never>(() => undefined),
            delay: async () => undefined,
            timeoutMs: 1,
          }
        );
      } catch (caught) {
        error = caught;
      }
      assert.match(String(error), /PAPER_SEARCH_FAILED.*timed out/);
    });
  });

  describe('duplicate and collection helpers', function () {
    it('finds DOI fields, Extra DOI values, normalized titles, and deleted items', function () {
      assert.equal(findDuplicatePaper([zoteroItem({ DOI: '10.1000/ONE', title: 'One' })], 'https://doi.org/10.1000/one', 'Other')?.matchedBy, 'doi');
      assert.equal(findDuplicatePaper([zoteroItem({ title: 'One' }, { extraDoi: '10.1000/extra' })], '10.1000/extra', 'Other')?.matchedBy, 'doi');
      const titleMatch = findDuplicatePaper([zoteroItem({ title: 'A Paper: Test' }, { deleted: true })], '10.1000/new', 'a paper test');
      assert.equal(titleMatch?.matchedBy, 'title');
      assert.isTrue(titleMatch?.deleted);
    });

    it('reuses only the exact root download collection name', function () {
      const expected = { id: 2, name: 'AI 下载文献' };
      assert.strictEqual(findDownloadCollection([{ id: 1, name: 'Agent 下载' }, expected]), expected);
      assert.isUndefined(findDownloadCollection([{ id: 1, name: 'AI下载文献' }]));
    });
  });

  describe('Zotero import orchestration', function () {
    const fullText: PaperAttachmentResult = {
      itemId: 30,
      key: 'PDF',
      title: 'PDF',
      contentType: 'application/pdf',
      fileExists: true,
      isFullText: true,
    };

    it('stops before collection creation and import when a duplicate exists', async function () {
      let collectionCalls = 0;
      let importCalls = 0;
      let error: unknown;
      try {
        await addPaperToZotero(
          { doi: '10.1000/paper', title: 'A Paper' },
          addDependencies({
            getAllItems: async () => [zoteroItem({ title: 'A Paper', DOI: '10.1000/paper' })],
            ensureCollection: async () => {
              collectionCalls++;
              return { collection: {}, created: false };
            },
            importByDoi: async () => {
              importCalls++;
              return [];
            },
          })
        );
      } catch (caught) {
        error = caught;
      }
      assert.match(String(error), /DUPLICATE_ITEM/);
      assert.equal(collectionCalls, 0);
      assert.equal(importCalls, 0);
    });

    it('accepts a full-text attachment returned by the DOI translator', async function () {
      let fallbackCalls = 0;
      const result = await addPaperToZotero(
        { doi: '10.1000/paper', title: 'A Paper' },
        addDependencies({
          inspectItemAttachments: async () => [fullText],
          addAvailableFile: async () => {
            fallbackCalls++;
            return false;
          },
        })
      );
      assert.isTrue(result.fullTextDownloaded);
      assert.equal(fallbackCalls, 0);
      assert.equal(result.collection.name, 'AI 下载文献');
    });

    it('uses Zotero file discovery when translation has no full text', async function () {
      let inspections = 0;
      let fallbackCalls = 0;
      const result = await addPaperToZotero(
        { doi: '10.1000/paper', title: 'A Paper' },
        addDependencies({
          inspectItemAttachments: async () => (++inspections === 1 ? [] : [fullText]),
          canFindFile: () => true,
          addAvailableFile: async () => {
            fallbackCalls++;
            return true;
          },
        })
      );
      assert.isTrue(result.fullTextDownloaded);
      assert.equal(fallbackCalls, 1);
      assert.equal(inspections, 2);
    });

    it('keeps the item and returns a warning when no local full text exists', async function () {
      let rollbackCalls = 0;
      const result = await addPaperToZotero(
        { doi: '10.1000/paper', title: 'A Paper' },
        addDependencies({
          canFindFile: () => true,
          addAvailableFile: async () => {
            throw new Error('download failed');
          },
          rollback: async () => {
            rollbackCalls++;
          },
        })
      );
      assert.isFalse(result.fullTextDownloaded);
      assert.equal(result.warningCode, 'NO_FULL_TEXT_ATTACHMENT');
      assert.equal(rollbackCalls, 0);
    });

    it('does not count a missing PDF attachment record as downloaded full text', async function () {
      const missingPdf: PaperAttachmentResult = { ...fullText, fileExists: false, isFullText: false };
      const result = await addPaperToZotero(
        { doi: '10.1000/paper', title: 'A Paper' },
        addDependencies({
          inspectItemAttachments: async () => [missingPdf],
          canFindFile: () => false,
        })
      );
      assert.isFalse(result.fullTextDownloaded);
      assert.equal(result.attachments[0].contentType, 'application/pdf');
      assert.isFalse(result.attachments[0].fileExists);
      assert.equal(result.warningCode, 'NO_FULL_TEXT_ATTACHMENT');
    });

    it('rolls back imported objects and a new collection when metadata import is invalid', async function () {
      const imported = [zoteroItem({ title: 'One' }, { id: 1 }), zoteroItem({ title: 'Two' }, { id: 2 })];
      let rollbackArgs: any[] | undefined;
      let error: unknown;
      try {
        await addPaperToZotero(
          { doi: '10.1000/paper', title: 'A Paper' },
          addDependencies({
            ensureCollection: async () => ({ collection: { id: 7, name: 'AI 下载文献' }, created: true }),
            importByDoi: async () => imported,
            rollback: async (...args) => {
              rollbackArgs = args;
            },
          })
        );
      } catch (caught) {
        error = caught;
      }
      assert.match(String(error), /PAPER_IMPORT_FAILED/);
      assert.strictEqual(rollbackArgs?.[0], imported);
      assert.isTrue(rollbackArgs?.[2]);
    });
  });
});
