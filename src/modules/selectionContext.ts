// src/modules/selectionContext.ts

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
    const selextedPageIndexes = isCrossPage
      ? [index.pageIndex!, index.pageIndex! + 1]
      : [index.pageIndex!];
    const fullText = await Zotero.PDFWorker.getFullText(
      itemID,
      selextedPageIndexes,
    );
    // ztoolkit.log("full-text", fullText);
    const data = await Zotero.PDFWorker.getRecognizerData(itemID);
    const currentPage = data.pages[index.pageIndex!];
    //TODO: get context by search
    if (lineCount <= 10) {
      // search in fullText
      const maches = countOccurrencesInFullText(fullText.text, selectedText);
      const macheCount = maches.length;
      const contextSize = 70;
      ztoolkit.log("search-matches", maches);
      if (macheCount == 1) {
        addon.data.userPrompt = getContextAroundIndex(
          fullText.text,
          [maches[0].start, maches[0].end],
          contextSize + 30,
        );
        ztoolkit.log("selected context by search:", addon.data.userPrompt);
      } else if (
        selectedText.split(" ").length <= 5 ||
        selectedText.length <= 5
      ) {
        // words only, use position match
        // ztoolkit.log(selected.position?.rects);
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
    // find a array, recursively
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
  if (typeof text !== "string" || !Array.isArray(index) || index.length < 2) {
    return ["", "", ""];
  }

  let start = Math.max(0, Math.min(index[0], text.length));
  let end = Math.max(0, Math.min(index[1], text.length));
  if (start > end) [start, end] = [end, start];

  const selected = start === end ? "" : text.substring(start, end);

  // 左侧处理
  const leftSlice = text.slice(0, start);
  const leftMatches = Array.from(leftSlice.matchAll(/\S+/g)); // 非空白序列及其索引
  let leftCtx = "";
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
  let rightCtx = "";
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

function getWordNearIndex(text: string, index: number): string;
function getWordNearIndex(text: string, index: Array<number>): string;
function getWordNearIndex(text: string, index: any): string {
  const headIndex = Array.isArray(index) ? index[0] : index;
  const tailIndex = Array.isArray(index) ? index[1] : index;
  const left = Math.max(
    text.lastIndexOf(" ", tailIndex),
    text.lastIndexOf("\n", tailIndex),
  );
  const right = Math.min(
    text.indexOf(" ", headIndex + 1),
    text.indexOf("\n", headIndex + 1),
  );
  return text.substring(left + 1, right === -1 ? text.length : right);
}

function parseSortIndex(str: string): {
  indexType: "pdf" | "epub" | "html";
  pageIndex: number | null;
  offset: number | null;
  top_y: number | null;
} | null {
  if (typeof str !== "string") return null;

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

  const maches: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + selected.length;
    maches.push({ start, end });
  }

  return maches;
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
