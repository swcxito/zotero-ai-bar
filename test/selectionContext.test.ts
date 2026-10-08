import { assert } from 'chai';
import { getSelectionContext, waitForSelectionContext } from '../src/utils/selectionContext';

describe('selection context', function () {
  describe('selection context request lifecycle', function () {
    const scope = globalThis as any;
    let originalZtoolkit: any;
    let logs: any[][];

    beforeEach(function () {
      originalZtoolkit = scope.ztoolkit;
      logs = [];
      scope.ztoolkit = { log: (...args: any[]) => logs.push(args) };
    });

    afterEach(function () {
      scope.ztoolkit = originalZtoolkit;
    });

    it('preserves context that is ready and permits requests without context', async function () {
      const context = ['before', 'selection', 'after'];
      assert.strictEqual(await waitForSelectionContext(Promise.resolve(context)), context);
      assert.isUndefined(await waitForSelectionContext(undefined));
      assert.isEmpty(logs);
    });

    it('continues without context when the PDF worker never settles', async function () {
      const pending = new Promise<string[] | undefined>(() => undefined);
      assert.isUndefined(await waitForSelectionContext(pending, { timeoutMs: 10 }));
      assert.include(logs[0][0], 'timed out');
    });

    it('continues without context when PDF extraction fails', async function () {
      assert.isUndefined(await waitForSelectionContext(Promise.reject(new Error('PDF unavailable'))));
      assert.include(logs[0][0], 'failed');
    });

    it('stops immediately while context is pending, allowing the next request', async function () {
      const controller = new AbortController();
      let rejectContext!: (error: Error) => void;
      const context = new Promise<string[] | undefined>((_resolve, reject) => {
        rejectContext = reject;
      });
      const waiting = waitForSelectionContext(context, { signal: controller.signal });
      controller.abort();
      let error: any;
      try {
        await waiting;
      } catch (caught) {
        error = caught;
      }
      assert.equal(error?.name, 'AbortError');
      const nextContext = ['new before', 'new selection', 'new after'];
      assert.strictEqual(await waitForSelectionContext(Promise.resolve(nextContext)), nextContext);
      // The worker may fail later; that rejection must be consumed without
      // affecting the next request or reporting an error for a stopped turn.
      rejectContext(new Error('late worker failure'));
      await Promise.resolve();
      assert.isEmpty(logs);
    });

    it('honors cancellation that happened before waiting began', async function () {
      const controller = new AbortController();
      controller.abort();
      let error: any;
      try {
        await waitForSelectionContext(Promise.resolve(['stale']), { signal: controller.signal });
      } catch (caught) {
        error = caught;
      }
      assert.equal(error?.name, 'AbortError');
    });

    it('ignores a worker rejection after falling back on timeout', async function () {
      let rejectContext!: (error: Error) => void;
      const context = new Promise<string[] | undefined>((_resolve, reject) => {
        rejectContext = reject;
      });
      await waitForSelectionContext(context, { timeoutMs: 10 });
      rejectContext(new Error('late failure'));
      await Promise.resolve();
      assert.lengthOf(logs, 1);
    });
  });

  describe('PDF selection context extraction', function () {
    const scope = globalThis as any;
    let originals: { Zotero: any; addon: any; ztoolkit: any; IOUtils: any };
    let calls: any[][];

    beforeEach(function () {
      originals = { Zotero: scope.Zotero, addon: scope.addon, ztoolkit: scope.ztoolkit, IOUtils: scope.IOUtils };
      calls = [];
      scope.Zotero = {
        Prefs: { get: () => 70 },
        debug: () => undefined,
        PDFWorker: {
          getFullText: async (...args: any[]) => {
            calls.push(args);
            return { text: 'before selected text after' };
          },
        },
      };
      scope.addon = { data: { selection: { text: 'newer selection' } } };
      scope.ztoolkit = { log: () => undefined };
    });

    afterEach(function () {
      Object.assign(scope, originals);
    });

    function annotation(pageIndex: number, crossPage = false): any {
      return {
        text: 'selected text',
        sortIndex: `${String(pageIndex).padStart(5, '0')}|000010|00010`,
        position: { rects: [[0, 0, 10, 10]], ...(crossPage ? { nextPageRects: [[0, 0, 10, 10]] } : {}) },
      };
    }

    it('passes a page count to Zotero, including the first and later selected pages', async function () {
      const reader = { itemID: 684, _internalReader: { _type: 'pdf' } } as any;
      for (const pageIndex of [0, 7]) {
        assert.deepEqual(await getSelectionContext(reader, { annotation: annotation(pageIndex) }), ['before ', 'selected text', ' after']);
        assert.deepEqual(calls.at(-1), [684, pageIndex + 1, true]);
      }
      assert.equal(scope.addon.data.selection.text, 'newer selection', 'Extraction must not overwrite a newer selection');
    });

    it('includes the next page for a selection spanning two pages', async function () {
      const reader = { itemID: 684, _internalReader: { _type: 'pdf' } } as any;
      await getSelectionContext(reader, { annotation: annotation(7, true) });
      assert.deepEqual(calls[0], [684, 9, true]);
    });

    it('handles extraction rejection even before a user sends a request', async function () {
      scope.Zotero.PDFWorker.getFullText = async () => {
        throw new Error('PDF extraction failed');
      };
      const reader = { itemID: 684, _internalReader: { _type: 'pdf' } } as any;
      assert.isUndefined(await getSelectionContext(reader, { annotation: annotation(0) }));
    });

    it('bounds PDF coordinate extraction for a repeated short abbreviation such as LA', async function () {
      this.timeout(5000);
      let recognizerCalled = false;
      scope.Zotero.PDFWorker.getFullText = async () => ({ text: 'A limiting amplifier (LA) is used. The LA output is measured.' });
      scope.Zotero.PDFWorker.getRecognizerData = () => {
        recognizerCalled = true;
        return new Promise(() => undefined);
      };
      const reader = { itemID: 684, _internalReader: { _type: 'pdf' } } as any;
      const selected = { ...annotation(0), text: 'LA' };
      assert.isUndefined(await getSelectionContext(reader, { annotation: selected }));
      assert.isTrue(recognizerCalled, 'Exercise the single-word coordinate fallback');
    });

    function setUpBatchWorker(modern: boolean) {
      const actions: Array<{ action: string; pageIndexes?: number[] }> = [];
      scope.IOUtils = { read: async () => new Uint8Array([1, 2, 3]) };
      scope.Zotero.Items = {
        getAsync: async () => ({ isPDFAttachment: () => true, getFilePathAsync: async () => '/fixture.pdf' }),
      };
      const worker = scope.Zotero.PDFWorker;
      worker.getFullText = async () => ({ text: 'LA and LA' });
      if (modern) worker.getStructuredDocumentText = () => undefined;
      const prefix = modern ? 'pdf.' : '';
      worker._query = async (action: string, data: any) => {
        actions.push({ action, ...(data.pageIndexes ? { pageIndexes: data.pageIndexes } : {}) });
        if (action === `${prefix}deletePages`) return { buf: new ArrayBuffer(3) };
        if (action === `${prefix}getRecognizerData`) return { pages: [[]], totalPages: 1 };
        throw new Error(`Unknown worker action: ${action}`);
      };
      return actions;
    }

    it('uses namespaced PDF tasks for LA after the first five pages on modern Zotero', async function () {
      const actions = setUpBatchWorker(true);
      const reader = { itemID: 900001, _internalReader: { _type: 'pdf' } } as any;
      for (const pageIndex of [7, 8]) {
        const selected = { ...annotation(pageIndex), text: 'LA' };
        assert.deepEqual(await getSelectionContext(reader, { annotation: selected }), ['', '', '']);
      }
      assert.deepEqual(
        actions.map(({ action }) => action),
        ['pdf.deletePages', 'pdf.getRecognizerData', 'pdf.deletePages', 'pdf.getRecognizerData']
      );
      assert.lengthOf(actions[0].pageIndexes!, 7);
      assert.lengthOf(actions[2].pageIndexes!, 8, 'Each page offset needs its own cached batch');
    });

    it('retains the original PDF task names for older Zotero workers', async function () {
      const actions = setUpBatchWorker(false);
      const reader = { itemID: 900002, _internalReader: { _type: 'pdf' } } as any;
      await getSelectionContext(reader, { annotation: { ...annotation(7), text: 'LA' } });
      assert.deepEqual(
        actions.map(({ action }) => action),
        ['deletePages', 'getRecognizerData']
      );
    });

    it('evicts a failed batch so a later translation can retry extraction', async function () {
      const actions = setUpBatchWorker(true);
      const reader = { itemID: 900003, _internalReader: { _type: 'pdf' } } as any;
      const query = scope.Zotero.PDFWorker._query;
      scope.Zotero.PDFWorker._query = async () => {
        throw new Error('Temporary PDF worker failure');
      };
      const selected = { ...annotation(7), text: 'LA' };
      assert.isUndefined(await getSelectionContext(reader, { annotation: selected }));
      scope.Zotero.PDFWorker._query = query;
      assert.deepEqual(await getSelectionContext(reader, { annotation: selected }), ['', '', '']);
      assert.lengthOf(actions, 2);
    });
  });
});
