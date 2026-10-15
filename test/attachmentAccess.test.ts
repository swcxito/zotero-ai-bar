import { assert } from 'chai';
import { resolveAttachment, AttachmentSelectionError } from '../src/utils/attachments';
import { readItemText, searchItemAttachments } from '../src/utils/zoteroItemAccess';

describe('shared attachment access', function () {
  let original: any;
  let originalToolkit: any;

  beforeEach(function () {
    original = (globalThis as any).Zotero;
    originalToolkit = (globalThis as any).ztoolkit;
    const attachment = (id: number, type: string, text?: string) => ({
      id,
      parentID: 1,
      attachmentContentType: type,
      attachmentText: text,
      isAttachment: () => true,
      getField: () => `File ${id}`,
    });
    const entries: Record<number, any> = {
      1: { id: 1, getAttachments: () => [11, 12, 13], isRegularItem: () => true, getField: () => '', getCreators: () => [] },
      11: attachment(11, 'application/pdf', 'needle A\fneedle B'),
      12: attachment(12, 'text/plain', 'needle C\nneedle D'),
      13: attachment(13, 'image/png'),
    };
    (globalThis as any).Zotero = {
      Items: { get: (id: number) => entries[id] },
      PDFWorker: { getFullText: async (id: number) => ({ text: entries[id].attachmentText }) },
    };
    (globalThis as any).ztoolkit = { log: () => {} };
  });

  afterEach(function () {
    (globalThis as any).Zotero = original;
    (globalThis as any).ztoolkit = originalToolkit;
  });

  it('requires an explicit file for ambiguous reads and preserves an explicit attachment', async function () {
    assert.throws(() => resolveAttachment(1), AttachmentSelectionError);
    assert.equal(resolveAttachment(12)?.id, 12);
    const result = await readItemText(1, undefined, 1);
    assert.property(result, 'candidates');
    const text = await readItemText(12, undefined, 1, 2);
    assert.include((text as any).text, 'needle C');
    assert.equal((text as any).attachmentId, 12);
  });

  it('paginates across files, annotates provenance and never invents non-PDF pages', async function () {
    const first = await searchItemAttachments(1, 'needle', false, 3);
    assert.equal(first.totalMatches, 4);
    assert.deepEqual(
      first.excerpts.map((match) => match.attachmentId),
      [11, 11, 12]
    );
    assert.equal(first.excerpts[1].page, 2);
    assert.isUndefined(first.excerpts[2].page);
    assert.equal(first.nextOffset, 3);
    assert.equal(first.unreadableAttachments[0].attachmentId, 13);
    const last = await searchItemAttachments(1, 'needle', false, 3, first.nextOffset);
    assert.deepEqual(
      last.excerpts.map((match) => [match.attachmentId, match.line]),
      [[12, 2]]
    );
    assert.isFalse(last.truncated);
    assert.equal((await searchItemAttachments(11, 'needle', false)).totalMatches, 2);
  });

  it('does not turn cancellation into an unreadable-file result', async function () {
    const abort = new AbortController();
    abort.abort();
    let error: any;
    try {
      await searchItemAttachments(1, 'needle', false, 50, 0, abort.signal);
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.name, 'AbortError');
  });
});
