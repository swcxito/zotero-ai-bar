// src/modules/selectionContext.ts
// TODO fix unexpected empty context result when selection is after page5

/**
 * 获取选中内容的上下文
 */
export async function getSelectionContext(
  reader: _ZoteroTypes.ReaderInstance<"pdf" | "epub" | "snapshot">,
  params: { annotation: _ZoteroTypes.Annotations.AnnotationJson },
) {
  const itemID = reader.itemID;
  const selected = params.annotation;
  const selectedText = selected.text.trim();
  addon.data.selectedText = selectedText;
  const isCrossPage = !!(
    selected.position?.rects && selected.position?.nextPageRects
  );
  const lineCount =
    (selected.position?.rects.length || 0) +
    (isCrossPage ? selected.position.nextPageRects.length || 0 : 0);
  if (isCrossPage) ztoolkit.log("跨页选中");
  const index = parseSortIndex(selected.sortIndex);

  if (
    itemID &&
    index?.indexType === "pdf" &&
    reader._internalReader._type === "pdf"
  ) {
    const selectedPageIndexes = isCrossPage
      ? [index.pageIndex!, index.pageIndex! + 1]
      : [index.pageIndex!];
    const fullText = await Zotero.PDFWorker.getFullText(
      itemID,
      selectedPageIndexes,
    );
    // ztoolkit.log("full-text", fullText);
    // const data = await Zotero.PDFWorker.getRecognizerData(itemID);
    const data = await getPageBatchRecognizerData(itemID, index.pageIndex!);
    const currentPage = data.pages[0];
    //TODO: get context by search
    if (lineCount <= 10) {
      // search in fullText
      const matches = countOccurrencesInFullText(fullText.text, selectedText);
      const macheCount = matches.length;
      const contextSize = 70;
      ztoolkit.log("search-matches", matches);
      if (macheCount == 1) {
        addon.data.userPrompt = getContextAroundIndex(
          fullText.text,
          [matches[0].start, matches[0].end],
          contextSize + 30,
        );
        ztoolkit.log("selected context by search:", addon.data.userPrompt);
      } else if (
        selectedText.split(" ").length <= 5 ||
        selectedText.length <= 5
      ) {
        // words only, use position match
        // ztoolkit.log(selected.position?.rects);
        ztoolkit.log("data:", data);
        ztoolkit.log("current-page:", currentPage);
        addon.data.userPrompt = getContextByPosition(
          selected,
          currentPage,
          contextSize,
          isCrossPage ? data.pages[index.pageIndex! + 1] : undefined,
        );
        ztoolkit.log("selected context by position:", addon.data.userPrompt);
      }
    }
  }
  //TODO: get context by index
  // const word = getWordNearIndex(text.text, index.offset!);
  // ztoolkit.log(word, "word near cursor");
  // ztoolkit.log(reader._iframeWindow);
  // const viewer = reader._primaryView as _ZoteroTypes.Reader.PDFView;
  // const pdfDocument = viewer._iframeWindow?.PDFViewerApplication.pdfDocument;
  // const pdfjsLib = viewer._iframeWindow?.pdfjsLib;
  // pdfjsLib?.getDocument(path)
  // const path = reader._item.attachmentPath;
  // not accessible due to CORS policy
  // const chars = await pdfDocument?.getPageData({ pageIndex: index.pageIndex! });
}

function getContextByPosition(
  selected: _ZoteroTypes.Annotations.AnnotationJson,
  page: Array<any>,
  contextSize: number = 50,
  nextPage: Array<any> | undefined = undefined,
): Array<string> {
  if (
    !Array.isArray(page) ||
    page.length < 3 ||
    typeof page[0] !== "number" ||
    typeof page[1] !== "number" ||
    !Array.isArray(page[2])
  ) {
    ztoolkit.log("invalid-page-structure", page);
    return ["", "", ""];
  }

  const pageSize = { width: page[0], height: page[1] };
  const selectedHead = {
    x: selected.position?.rects[0][0],
    y: pageSize.height - selected.position?.rects[0][1],
    char: selected.text.trim()[0],
  };
  ztoolkit.log("selected-head", selectedHead);
  // ztoolkit.log("current-page-data", page);
  const flatTextBoxes: Array<TextBox> = parseArray(page);
  const sortedFlatTextBoxes = flatTextBoxes.toSorted((a, b) => {
    // sort only first-level boxes by distance to selection head
    const a_x = a[0];
    const a_y = a[3];
    const b_x = b[0];
    const b_y = b[3];
    const a_dist = Math.sqrt(
      Math.pow(a_x - selectedHead.x!, 2) + Math.pow(a_y - selectedHead.y!, 2),
    );
    const b_dist = Math.sqrt(
      Math.pow(b_x - selectedHead.x!, 2) + Math.pow(b_y - selectedHead.y!, 2),
    );
    return a_dist - b_dist;
  });
  const selectedBox = sortedFlatTextBoxes.find(
    (box) => box[13] && box[13][0] === selectedHead.char,
  );
  ztoolkit.log("selected-box", selectedBox);
  if (selectedBox) {
    if (nextPage) {
      // append next page boxes
      const nextPageBoxes: Array<TextBox> = parseArray(
        nextPage,
        flatTextBoxes.length,
      );
      flatTextBoxes.push(...nextPageBoxes);
    }
    const selectedIndex = selectedBox[14];
    const leftBoxes = flatTextBoxes.slice(
      selectedIndex - contextSize,
      selectedIndex,
    );
    const rightBoxes = flatTextBoxes.slice(
      selectedIndex + 1,
      selectedIndex + 1 + contextSize,
    );
    return [
      leftBoxes.map((box) => box[13]).join(" "),
      selectedBox[13],
      rightBoxes.map((box) => box[13]).join(" "),
    ];
  }
  return ["", selected.text.trim(), ""];
}

function parseArray(page: Array<any>, indexOffset: number = 0): Array<TextBox> {
  const flatTextBoxes: Array<TextBox> = [];
  function walk(node: any, index: number) {
    // find an array, recursively
    if (Array.isArray(node)) {
      if (node.length === 14 && typeof node[13] === "string") {
        const textBoxNode = node as TextBox;
        textBoxNode.push(flatTextBoxes.length + indexOffset); // add index
        flatTextBoxes.push(textBoxNode);
      } else
        for (let i = 0; i < node.length; i++) {
          walk(node[i], i);
        }
    }
  }
  walk(page[2], 0);
  return flatTextBoxes;
}

/**
 * 从文本和给定选区索引处，向前/后各取 contextSize 个“单元”作为上下文返回。
 * 单元优先按“单词”（以任意空白分隔的非空序列）计数；若可用单词不足，则以字符数补足到 contextSize。
 *
 * 参数:
 *  - text: 完整文本
 *  - index: [start, end]，start 为选区开始索引，end 为选区结束索引（基于 text 的字符索引）
 *  - contextSize: 希望在左右两侧各获取的单元数，默认 30
 *
 * 返回:
 *  - [leftContext, selectedText, rightContext]
 *    leftContext: 选区左侧的上下文（若不存在则为空字符串）
 *    selectedText: 选区文本（若索引非法或长度为0则为空字符串）
 *    rightContext: 选区右侧的上下文（若不存在则为空字符串）
 */
function getContextAroundIndex(
  text: string,
  index: Array<number>,
  contextSize: number = 50,
): Array<string> {
  if (!Array.isArray(index) || index.length < 2) {
    return ["", "", ""];
  }

  let start = Math.max(0, Math.min(index[0], text.length));
  let end = Math.max(0, Math.min(index[1], text.length));
  if (start > end) [start, end] = [end, start];

  const selected = start === end ? "" : text.substring(start, end);

  // 左侧处理
  const leftSlice = text.slice(0, start);
  const leftMatches = Array.from(leftSlice.matchAll(/\S+/g)); // 非空白序列及其索引
  let leftCtx;
  if (leftSlice.length === 0) {
    leftCtx = "";
  } else if (leftMatches.length >= contextSize) {
    // 有足够单词，取最后 contextSize 个单词（包含它们之间的原始空白）
    const firstIncluded = leftMatches[leftMatches.length - contextSize];
    leftCtx = leftSlice.slice(firstIncluded.index);
  } else {
    // 单词不足，回退到按字符数取最后 contextSize 个字符
    leftCtx = leftSlice.slice(Math.max(0, leftSlice.length - contextSize));
  }

  // 右侧处理
  const rightSlice = text.slice(end);
  const rightMatches = Array.from(rightSlice.matchAll(/\S+/g));
  let rightCtx;
  if (rightSlice.length === 0) {
    rightCtx = "";
  } else if (rightMatches.length >= contextSize) {
    // 有足够单词，取前 contextSize 个单词（包含它们之间的原始空白）
    const lastIncluded = rightMatches[contextSize - 1];
    rightCtx = rightSlice.slice(0, lastIncluded.index + lastIncluded[0].length);
  } else {
    // 单词不足，按字符数取前 contextSize 个字符
    rightCtx = rightSlice.slice(0, Math.min(rightSlice.length, contextSize));
  }

  return [leftCtx, selected, rightCtx];
}

function parseSortIndex(str: string): {
  indexType: "pdf" | "epub" | "html";
  pageIndex: number | null;
  offset: number | null;
  top_y: number | null;
} | null {

  // PDF 附件：xxxxx|xxxxxx|xxxxx => pageIndex|offset|top
  let m = str.match(/^(\d+)\|(\d+)\|(\d+)$/);
  if (m) {
    return {
      indexType: "pdf",
      pageIndex: parseInt(m[1], 10),
      offset: parseInt(m[2], 10),
      top_y: parseInt(m[3], 10),
    };
  }

  // EPUB 附件：xxxxx|xxxxxxxx => pageIndex|charCount
  m = str.match(/^(\d+)\|(\d+)$/);
  if (m) {
    return {
      indexType: "epub",
      pageIndex: parseInt(m[1], 10),
      offset: parseInt(m[2], 10),
      top_y: null,
    };
  }

  // HTML 附件：xxxxxxx => charCount
  m = str.match(/^(\d+)$/);
  if (m) {
    return {
      indexType: "html",
      pageIndex: null,
      offset: parseInt(m[1], 10),
      top_y: null,
    };
  }

  // 校验失败
  return null;
}

function countOccurrencesInFullText(
  fullText: string | string[],
  selected: string,
): Array<{ start: number; end: number }> {
  if (!selected) return [];

  const text = Array.isArray(fullText) ? fullText.join(" ") : fullText;
  if (!text) return [];

  const escaped = selected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");

  const matches: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + selected.length;
    matches.push({ start, end });
  }

  return matches;
}

/**
 * 获取从指定页开始的详细版面数据（RecognizerData）
 * 由于 Zotero Worker 限制，每次调用最多只能获取 5 页数据。
 *
 * @param  itemID - Zotero 附件条目 ID
 * @param  startIndex - 起始页索引（0-based，即第1页为0）
 * @returns {Promise<Object>} 返回包含 metadata 和 pages 数组的数据对象。pageIndex 已自动修正为原始页码。
 */
async function getPageBatchRecognizerData(itemID:number, startIndex:number) {
  // 1. 获取附件对象并验证
  const attachment = await Zotero.Items.getAsync(itemID);
  if (!attachment.isPDFAttachment()) {
    throw new Error(`Item ${itemID} is not a PDF attachment`);
  }

  // 2. 将文件读取到内存
  // IOUtils.read 返回 Uint8Array，需转为 ArrayBuffer 供 Worker 使用
  const path = await attachment.getFilePathAsync();
  if(!path) {
    throw new Error(`Attachment ${itemID} has no valid file path`);
  }
  const rawData = await IOUtils.read(path);
  let buf = new Uint8Array(rawData).buffer;

  // 3. 如果起始页 > 0，需要在内存中删除前面的所有页面
  // 使得目标起始页变成新 Buffer 的第 0 页
  if (startIndex > 0) {
    // 生成要删除的页码数组：[0, 1, ..., startIndex - 1]
    const pageIndexesToDelete = Array.from({ length: startIndex }, (_, i) => i);

    try {
      // 调用 Worker 的 deletePages 动作
      // 使用 _query 私有方法直接通信，不经过 manager.js 的封装，避免副作用
      const result = await Zotero.PDFWorker._query(
        'deletePages',
        {
          buf: buf,
          pageIndexes: pageIndexesToDelete,
          password: ''
        },
        [buf] // [Important] Transferable: 转移 buffer 所有权给 worker，防止拷贝，提升性能
      );
      buf = result.buf;
    } catch (e: any) {
      Zotero.debug(`[Plugin] Failed to seek to page ${startIndex}: ${e.message}`);
      throw e;
    }
  }

  // 4. 调用 getRecognizerData 获取数据（硬编码只能获取新 Buffer 的前 5 页）
  let data;
  try {
    data = await Zotero.PDFWorker._query(
      'getRecognizerData',
      {
        buf: buf,
        password: ''
      },
      [buf] // 再次转移所有权
    );
  } catch (e: any) {
    const msg = typeof e === 'object' && e.message ? e.message : JSON.stringify(e);
    throw new Error(`Failed to get recognizer data: ${msg}`);
  }

  // 5. 数据后处理
  if (data && data.pages) {
    // 修正页码：Worker 返回的页码是基于裁切后的 PDF（从 0 开始），需加上 startIndex 偏移
    data.pages.forEach((page: { pageIndex: number; }) => {
      page.pageIndex = page.pageIndex + startIndex;
    });

    // 修正总页数：加上被删除的页数，使其反映原始文档情况
    if (data.totalPages) {
      data.totalPages = data.totalPages + startIndex;
    }
  }

  return data;
}

interface AnnotationRect {
  xMin: number; // 0: 左边界 X 坐标 (四舍五入到4位小数)
  yMin: number; // 1: 上边界 Y 坐标 (转换为从页面顶部开始)
  xMax: number; // 2: 右边界 X 坐标 (四舍五入到4位小数)
  yMax: number; // 3: 下边界 Y 坐标 (转换为从页面顶部开始)
}

type TextBox = [
  xMin: number, // 0: 左边界 X 坐标 (四舍五入到4位小数)
  yMin: number, // 1: 上边界 Y 坐标 (转换为从页面顶部开始)
  xMax: number, // 2: 右边界 X 坐标 (四舍五入到4位小数)
  yMax: number, // 3: 下边界 Y 坐标 (转换为从页面顶部开始)
  fontSize: number, // 4: 字体大小 (四舍五入到4位小数)
  spaceAfter: number, // 5: 单词后是否有空格 (0或1)
  baseline: number, // 6: 基线位置 (四舍五入到4位小数)
  rotation: number, // 7: 旋转角度 (目前固定为0)
  underlined: number, // 8: 是否下划线 (目前固定为0)
  bold: number, // 9: 是否粗体 (0或1)
  italic: number, // 10: 是否斜体 (0或1)
  colorIndex: number, // 11: 颜色索引 (目前固定为0)
  fontIndex: number, // 12: 字体索引 (在fonts数组中的索引)
  text: string, // 13: 实际文本内容 (字符串)
  index: number,
];
