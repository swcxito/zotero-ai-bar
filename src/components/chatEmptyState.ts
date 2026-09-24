import { config } from '../../package.json';
import { IconView } from './iconView';
import { getString } from '../utils/locale';
import { getPref, setPref } from '../utils/prefs';
import type { Session } from '../modules/chatManager';

interface Poem {
  text: string;
  attribution: string;
  sourceUrl?: string;
}

interface PoemState {
  poem?: Poem;
  attempted: boolean;
  todayRequests: number;
  lastRequestClicked: boolean;
  revision: number;
  pending?: Promise<void>;
}

class PoemApiError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message);
  }
}

const poems = new Map<string, PoemState>();
const views = new Set<ChatEmptyState>();
const MAX_CACHED_CONVERSATIONS = 64;
const MAX_TODAY_REQUESTS = 5;
const REQUEST_GAP_MS = 650;
const REQUEST_TIMEOUT_MS = 5000;
const POEM_MORPH_MS = 260;
const MIN_POEM_FONT_SIZE_PX = 20;
const POEM_BREAK_MARKS = new Set(['，', ',', '。', '.', '？', '?']);
let nextRequestAt = 0;
let tokenRequest: Promise<string> | undefined;

function isChineseLocale(): boolean {
  return (Zotero.locale || '').toLowerCase().startsWith('zh');
}

function trimmed(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function getPoemState(key: string): PoemState {
  let state = poems.get(key);
  if (!state) {
    state = { attempted: false, todayRequests: 0, lastRequestClicked: false, revision: 0 };
    poems.set(key, state);
    if (poems.size > MAX_CACHED_CONVERSATIONS) poems.delete(poems.keys().next().value!);
  }
  return state;
}

async function waitForRequestSlot(): Promise<void> {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + REQUEST_GAP_MS;
  if (scheduledAt > now) await new Promise<void>((resolve) => setTimeout(resolve, scheduledAt - now));
}

function parseJinrishici(result: unknown): Poem | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const response = result as Record<string, unknown>;
  if (response.status !== 'success' || !response.data || typeof response.data !== 'object') return undefined;
  const data = response.data as Record<string, unknown>;
  const text = trimmed(data.content, 240).replace(/。+$/u, '');
  if (!text) return undefined;
  const origin = data.origin && typeof data.origin === 'object' ? (data.origin as Record<string, unknown>) : {};
  const dynasty = trimmed(origin.dynasty, 24);
  const author = trimmed(origin.author, 60);
  const title = trimmed(origin.title, 80);
  const byline = [dynasty, author].filter(Boolean).join(' · ');
  return { text, attribution: `${byline}${title ? `「${title}」` : ''}` || '今日诗词' };
}

async function requestJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await Zotero.HTTP.request('GET', url, {
    headers,
    timeout: REQUEST_TIMEOUT_MS,
    errorDelayIntervals: [],
    successCodes: false,
  });
  const data = JSON.parse(response.responseText) as unknown;
  if (response.status < 200 || response.status >= 300) {
    const error = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    throw new PoemApiError(trimmed(error.errMessage, 160) || `HTTP ${response.status}`, Number(error.errCode) || undefined);
  }
  return data;
}

async function getTodayToken(): Promise<string> {
  const saved = trimmed(getPref('poem.token'), 256);
  if (saved) return saved;
  if (!tokenRequest) {
    tokenRequest = (async () => {
      const tokenResponse = (await requestJson('https://v2.jinrishici.com/token')) as Record<string, unknown>;
      const token = trimmed(tokenResponse.data, 256);
      if (tokenResponse.status !== 'success' || !token) throw new Error('今日诗词未签发 Token');
      setPref('poem.token', token);
      return token;
    })().finally(() => {
      tokenRequest = undefined;
    });
  }
  return tokenRequest;
}

async function loadTodaySentence(token: string): Promise<Poem> {
  const result = (await requestJson('https://v2.jinrishici.com/sentence', { 'X-User-Token': token })) as Record<string, unknown>;
  if (result.status !== 'success') {
    throw new PoemApiError(trimmed(result.errMessage, 160) || '今日诗词返回错误', Number(result.errCode) || undefined);
  }
  if (trimmed(result.token, 256) !== token) throw new Error('今日诗词返回的 Token 与本地保存值不一致');
  const poem = parseJinrishici(result);
  if (!poem) throw new Error('今日诗词未返回有效诗句');
  return poem;
}

async function loadTodayPoem(): Promise<Poem> {
  const token = await getTodayToken();
  try {
    return await loadTodaySentence(token);
  } catch (error) {
    if (!(error instanceof PoemApiError) || error.code !== 2002) throw error;
    setPref('poem.token', '');
    return loadTodaySentence(await getTodayToken());
  }
}

async function loadLegacyJinrishiciPoem(): Promise<Poem> {
  const data = (await requestJson('https://v1.jinrishici.com/all.json')) as Record<string, unknown>;
  const text = trimmed(data.content, 240).replace(/。+$/u, '');
  if (!text) throw new Error('旧版今日诗词未返回有效诗句');
  const author = trimmed(data.author, 60);
  const title = trimmed(data.origin, 80);
  return { text, attribution: `${author}${title ? `「${title}」` : ''}` || '今日诗词' };
}

async function loadHitokotoPoem(): Promise<Poem> {
  const data = (await requestJson('https://v1.hitokoto.cn/?c=i&encode=json&max_length=40')) as Record<string, unknown>;
  const text = trimmed(data.hitokoto, 240).replace(/。+$/u, '');
  if (!text || (data.type && data.type !== 'i')) throw new Error('一言接口未返回诗词');
  const author = trimmed(data.from_who, 60);
  const source = trimmed(data.from, 80);
  const uuid = trimmed(data.uuid, 64);
  const attribution = `${author}${source ? `「${source}」` : ''}` || '一言';
  const sourceUrl = /^[0-9a-f-]{8,64}$/i.test(uuid) ? `https://hitokoto.cn/?uuid=${encodeURIComponent(uuid)}` : undefined;
  return { text, attribution, sourceUrl };
}

function notifyViews(key: string): void {
  for (const view of views) {
    if (view.key === key) view.render();
  }
}

function storePoem(state: PoemState, poem: Poem): void {
  if (state.poem?.text !== poem.text) state.revision++;
  state.poem = poem;
}

function requestPoem(key: string, clicked: boolean): void {
  const state = getPoemState(key);
  if (state.pending) return;
  if (!clicked && state.attempted) {
    return;
  }
  state.attempted = true;
  state.lastRequestClicked = clicked;
  state.pending = (async () => {
    if (state.todayRequests < MAX_TODAY_REQUESTS) {
      state.todayRequests++;
      try {
        await waitForRequestSlot();
        storePoem(state, await loadTodayPoem());
        return;
      } catch (error) {
        Zotero.debug(`[zaibar-poem] 今日诗词请求失败: ${String(error)}`);
      }
    }
    try {
      await waitForRequestSlot();
      storePoem(state, await loadLegacyJinrishiciPoem());
      return;
    } catch (error) {
      Zotero.debug(`[zaibar-poem] 旧版今日诗词请求失败: ${String(error)}`);
    }
    try {
      await waitForRequestSlot();
      storePoem(state, await loadHitokotoPoem());
    } catch (error) {
      Zotero.debug(`[zaibar-poem] 一言备用接口请求失败: ${String(error)}`);
      // Keep the previous poem; the first-load view remains a retry icon.
    }
  })().finally(() => {
    state.pending = undefined;
    notifyViews(key);
  });
  notifyViews(key);
}

class ChatEmptyState {
  readonly keyForContainer: HTMLElement;
  key = '';
  private session?: Session;
  private readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly greeting: HTMLParagraphElement;
  private readonly poemButton: HTMLButtonElement;
  private readonly poemText: HTMLSpanElement;
  private readonly poemIcon: HTMLImageElement;
  private poemSegments: HTMLSpanElement[] = [];
  private poemBreaks: HTMLBRElement[] = [];
  private readonly sourceRow: HTMLDivElement;
  private readonly sourceText: HTMLSpanElement;
  private readonly sourceLink: HTMLAnchorElement;
  private readonly observer?: MutationObserver;
  private readonly resizeObserver?: ResizeObserver;
  private displayedPoemText = '';
  private displayedAttribution = '';
  private renderedLineCount = 0;
  private layoutAnimations: Animation[] = [];
  private transitionTarget?: string;
  private seenRevision = 0;
  private exitTimer?: ReturnType<typeof setTimeout>;
  private morphTimer?: ReturnType<typeof setTimeout>;
  private finishTimer?: ReturnType<typeof setTimeout>;

  constructor(doc: Document, container: HTMLElement, shell: HTMLElement) {
    this.keyForContainer = container;
    this.root = doc.createElement('div');
    this.root.className = 'chat-empty-state';
    this.root.hidden = true;
    this.content = doc.createElement('div');
    this.content.className = 'chat-empty-content';
    this.greeting = doc.createElement('p');
    this.greeting.className = 'chat-empty-greeting';
    this.greeting.textContent = getString('chat-empty-greeting');

    this.poemButton = ztoolkit.UI.createElement(doc, 'button', {
      namespace: 'html',
      classList: ['chat-empty-poem'],
      properties: { type: 'button' },
      attributes: { 'data-zaibar-copy-ignore': 'true' },
    }) as HTMLButtonElement;
    this.poemText = doc.createElement('span');
    this.poemText.className = 'chat-empty-poem-text';
    this.poemIcon = ztoolkit.UI.createElement(
      doc,
      'img',
      IconView({ iconMarkup: `chrome://${config.addonRef}/content/icons/favicon.svg`, sizeRem: 1, extraClasses: ['chat-empty-cursor'] })
    ) as HTMLImageElement;
    this.poemIcon.style.width = '0.7em';
    this.poemIcon.style.height = 'auto';
    this.poemIcon.setAttribute('aria-hidden', 'true');
    this.poemButton.append(this.poemText);
    this.poemButton.addEventListener('click', () => requestPoem(this.key, true));

    this.sourceRow = doc.createElement('div');
    this.sourceRow.className = 'chat-empty-source';
    this.sourceText = doc.createElement('span');
    this.sourceLink = ztoolkit.UI.createElement(doc, 'a', {
      namespace: 'html',
      attributes: { 'data-zaibar-copy-ignore': 'true' },
    }) as HTMLAnchorElement;
    this.sourceLink.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = this.sourceLink.href;
      if (url) Zotero.launchURL(url);
    });
    this.sourceRow.append(this.sourceText, this.sourceLink);
    this.content.append(this.greeting, this.poemButton, this.sourceRow);
    this.root.appendChild(this.content);
    shell.appendChild(this.root);

    const MutationObserverCtor = doc.defaultView?.MutationObserver;
    this.observer = MutationObserverCtor ? new MutationObserverCtor(() => this.updateVisibility()) : undefined;
    this.observer?.observe(container, { childList: true });
    const ResizeObserverCtor = (doc.defaultView as any)?.ResizeObserver as typeof ResizeObserver | undefined;
    this.resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(() => this.fitLayout(true)) : undefined;
    this.resizeObserver?.observe(this.root);
    views.add(this);
  }

  private setPoemSegments(text: string): void {
    this.poemSegments = [];
    this.poemBreaks = [];
    this.poemText.replaceChildren();
    if (!text) return;

    const characters = Array.from(text);
    let start = 0;
    const parts: string[] = [];
    for (let i = 0; i < characters.length - 1; i++) {
      if (i <= start || !POEM_BREAK_MARKS.has(characters[i]) || POEM_BREAK_MARKS.has(characters[i + 1])) continue;
      parts.push(characters.slice(start, i + 1).join(''));
      start = i + 1;
    }
    parts.push(characters.slice(start).join(''));
    const doc = this.root.ownerDocument;
    for (let i = 0; i < parts.length; i++) {
      const segment = doc.createElement('span');
      segment.className = 'chat-empty-poem-segment';
      if (i === parts.length - 1) {
        const lastCharacters = Array.from(parts[i]);
        segment.textContent = lastCharacters.slice(0, -2).join('');
        const ending = doc.createElement('span');
        ending.className = 'chat-empty-poem-ending';
        ending.textContent = lastCharacters.slice(-2).join('');
        ending.append(this.poemIcon);
        segment.append(ending);
      } else {
        segment.textContent = parts[i];
      }
      this.poemSegments.push(segment);
      this.poemText.append(segment);
      if (i < parts.length - 1) {
        const lineBreak = doc.createElement('br');
        lineBreak.hidden = true;
        this.poemBreaks.push(lineBreak);
        this.poemText.append(lineBreak);
      }
    }
  }

  private setPoemBreaks(indices: number[]): void {
    const breaks = new Set(indices);
    for (let i = 0; i < this.poemBreaks.length; i++) this.poemBreaks[i].hidden = !breaks.has(i);
  }

  private poemLineCount(): number {
    if (!this.poemSegments.length) return 0;
    const buttonStyle = this.root.ownerDocument.defaultView?.getComputedStyle(this.poemButton);
    const lineHeight = parseFloat(buttonStyle?.lineHeight || '0');
    const verticalPadding = parseFloat(buttonStyle?.paddingTop || '0') + parseFloat(buttonStyle?.paddingBottom || '0');
    return lineHeight ? Math.max(1, Math.round((this.poemButton.offsetHeight - verticalPadding) / lineHeight)) : 1;
  }

  private fitPoem(): void {
    if (this.root.hidden || this.poemButton.hidden) return;
    if (!this.displayedPoemText) {
      this.poemButton.style.removeProperty('font-size');
      this.poemButton.classList.remove('chat-empty-poem--single-line', 'chat-empty-poem--punctuation-break', 'chat-empty-poem--punctuation-wrap');
      return;
    }

    const view = this.root.ownerDocument.defaultView;
    if (!view) return;
    const previousWidth = this.content.style.width;
    const previousTransition = this.content.style.transition;
    this.content.style.transition = 'none';
    this.content.style.width = '100%';
    const availableWidth = this.content.getBoundingClientRect().width;
    this.content.style.width = previousWidth;
    this.content.style.transition = previousTransition;

    this.setPoemBreaks([]);
    this.poemButton.style.removeProperty('font-size');
    this.poemButton.classList.remove('chat-empty-poem--punctuation-break', 'chat-empty-poem--punctuation-wrap');
    this.poemButton.classList.add('chat-empty-poem--single-line');
    const buttonStyle = view.getComputedStyle(this.poemButton);
    if (!buttonStyle || !availableWidth) {
      this.poemButton.classList.remove('chat-empty-poem--single-line');
      return;
    }
    const padding = parseFloat(buttonStyle.paddingLeft) + parseFloat(buttonStyle.paddingRight);
    const baseSize = parseFloat(buttonStyle.fontSize);
    const fittedSize = () => {
      let lineWidth = 0;
      let maxWidth = 0;
      for (let i = 0; i < this.poemSegments.length; i++) {
        lineWidth += this.poemSegments[i].offsetWidth;
        if (this.poemBreaks[i]?.hidden === false || i === this.poemSegments.length - 1) {
          maxWidth = Math.max(maxWidth, lineWidth);
          lineWidth = 0;
        }
      }
      return maxWidth ? (baseSize * (availableWidth - padding - 2)) / maxWidth : 0;
    };
    const singleLineSize = fittedSize();

    if (singleLineSize >= MIN_POEM_FONT_SIZE_PX) {
      if (singleLineSize < baseSize) this.poemButton.style.fontSize = `${singleLineSize}px`;
      return;
    }

    this.poemButton.classList.remove('chat-empty-poem--single-line');
    if (!this.poemBreaks.length) {
      this.poemButton.style.fontSize = `${MIN_POEM_FONT_SIZE_PX}px`;
      this.poemButton.classList.add('chat-empty-poem--punctuation-wrap');
      return;
    }

    this.poemButton.classList.add('chat-empty-poem--punctuation-break');
    for (let i = this.poemBreaks.length - 1; i >= 0; i--) {
      this.setPoemBreaks([i]);
      const twoLineSize = fittedSize();
      if (twoLineSize < MIN_POEM_FONT_SIZE_PX) continue;
      if (twoLineSize < baseSize) this.poemButton.style.fontSize = `${twoLineSize}px`;
      return;
    }

    let breakIndices: number[] = [this.poemBreaks.length - 1];
    let bestScore = Infinity;
    let bestSize = 0;
    const boundaries: number[] = [];
    let length = 0;
    for (const segment of this.poemSegments) {
      length += Array.from(segment.textContent || '').length;
      boundaries.push(length);
    }
    for (let i = 0; i < this.poemBreaks.length; i++) {
      for (let j = i + 1; j < this.poemBreaks.length; j++) {
        this.setPoemBreaks([i, j]);
        const size = fittedSize();
        const score = Math.abs(boundaries[i] - length / 3) + Math.abs(boundaries[j] - (2 * length) / 3);
        if (size >= MIN_POEM_FONT_SIZE_PX && bestSize < MIN_POEM_FONT_SIZE_PX) {
          bestScore = Infinity;
        }
        if (size < MIN_POEM_FONT_SIZE_PX && bestSize >= MIN_POEM_FONT_SIZE_PX) continue;
        if (score < bestScore) {
          bestScore = score;
          bestSize = size;
          breakIndices = [i, j];
        }
      }
    }

    this.setPoemBreaks(breakIndices);
    const punctuationLineSize = fittedSize();
    if (punctuationLineSize >= MIN_POEM_FONT_SIZE_PX) {
      if (punctuationLineSize < baseSize) this.poemButton.style.fontSize = `${punctuationLineSize}px`;
    } else {
      this.poemButton.style.fontSize = `${MIN_POEM_FONT_SIZE_PX}px`;
      this.poemButton.classList.replace('chat-empty-poem--punctuation-break', 'chat-empty-poem--punctuation-wrap');
    }
  }

  private fitAttribution(): void {
    if (this.root.hidden || this.sourceRow.hidden) return;
    const text = this.sourceLink.hidden ? this.sourceText : this.sourceLink;
    text.textContent = this.displayedAttribution;
    this.sourceRow.classList.remove('chat-empty-source--author-break');
    if (!this.displayedAttribution) return;

    const view = this.root.ownerDocument.defaultView;
    if (!view) return;
    const rowStyle = view.getComputedStyle(this.sourceRow);
    if (!rowStyle) return;
    const availableWidth = this.sourceRow.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight);
    const previousWhiteSpace = text.style.whiteSpace;
    text.style.whiteSpace = 'nowrap';
    const textWidth = text.getBoundingClientRect().width;
    text.style.whiteSpace = previousWhiteSpace;
    if (textWidth <= availableWidth) return;

    const titleStart = this.displayedAttribution.indexOf('「');
    if (titleStart <= 0) return;
    text.textContent = `${this.displayedAttribution.slice(0, titleStart)}\n${this.displayedAttribution.slice(titleStart)}`;
    this.sourceRow.classList.add('chat-empty-source--author-break');
  }

  private fitLayout(animateLineChange = false): void {
    const previousLineCount = this.renderedLineCount;
    const previousBreaks = this.poemBreaks.map((lineBreak) => !lineBreak.hidden).join(',');
    const previousContent = this.content.getBoundingClientRect();
    const previousSource = this.sourceRow.getBoundingClientRect();
    const previousSegments = this.poemSegments.map((segment) => segment.getBoundingClientRect());
    const view = this.root.ownerDocument.defaultView;
    const canAnimate =
      animateLineChange &&
      previousLineCount > 0 &&
      !this.root.hidden &&
      !this.poemButton.hidden &&
      !!this.displayedPoemText &&
      !this.transitionTarget &&
      !view?.matchMedia('(prefers-reduced-motion: reduce)')?.matches &&
      typeof this.content.animate === 'function';
    this.fitPoem();
    this.fitAttribution();
    if (this.root.hidden || this.poemButton.hidden || !this.displayedPoemText) {
      for (const animation of this.layoutAnimations) animation.cancel();
      this.layoutAnimations = [];
      this.renderedLineCount = 0;
      return;
    }

    const nextBreaks = this.poemBreaks.map((lineBreak) => !lineBreak.hidden).join(',');
    this.renderedLineCount = this.poemLineCount();
    if (!canAnimate) {
      for (const animation of this.layoutAnimations) animation.cancel();
      this.layoutAnimations = [];
      return;
    }
    if (previousLineCount === this.renderedLineCount && previousBreaks === nextBreaks) return;

    for (const animation of this.layoutAnimations) animation.cancel();
    this.layoutAnimations = [];
    const timing: KeyframeAnimationOptions = { duration: 180, easing: 'ease-in-out' };
    const nextContent = this.content.getBoundingClientRect();
    const nextSource = this.sourceRow.getBoundingClientRect();
    const nextSegments = this.poemSegments.map((segment) => segment.getBoundingClientRect());
    const contentShiftX = previousContent.left - nextContent.left;
    const contentShiftY = previousContent.top - nextContent.top;
    this.layoutAnimations.push(
      this.content.animate([{ transform: `translate(${contentShiftX}px, ${contentShiftY}px)` }, { transform: 'translate(0, 0)' }], timing)
    );
    for (let i = 0; i < this.poemSegments.length; i++) {
      const before = previousSegments[i];
      if (!before) continue;
      const after = nextSegments[i];
      const shiftX = before.left - after.left - contentShiftX;
      const shiftY = before.top - after.top - contentShiftY;
      const scale = after.width ? Math.max(0.5, Math.min(2, before.width / after.width)) : 1;
      if (Math.abs(shiftX) < 0.5 && Math.abs(shiftY) < 0.5 && Math.abs(scale - 1) < 0.005) continue;
      this.layoutAnimations.push(
        this.poemSegments[i].animate(
          [{ transform: `translate(${shiftX}px, ${shiftY}px) scale(${scale})` }, { transform: 'translate(0, 0) scale(1)' }],
          timing
        )
      );
    }
    if (!this.sourceRow.hidden) {
      const shiftX = previousSource.left - nextSource.left - contentShiftX;
      const shiftY = previousSource.top - nextSource.top - contentShiftY;
      this.layoutAnimations.push(
        this.sourceRow.animate([{ transform: `translate(${shiftX}px, ${shiftY}px)` }, { transform: 'translate(0, 0)' }], timing)
      );
    }
    const animations = this.layoutAnimations;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (this.layoutAnimations === animations) this.layoutAnimations = [];
    });
  }

  private stopTransition(): void {
    for (const animation of this.layoutAnimations) animation.cancel();
    this.layoutAnimations = [];
    this.poemText.style.removeProperty('opacity');
    if (this.exitTimer) clearTimeout(this.exitTimer);
    if (this.morphTimer) clearTimeout(this.morphTimer);
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.exitTimer = undefined;
    this.morphTimer = undefined;
    this.finishTimer = undefined;
    this.transitionTarget = undefined;
    this.root.removeAttribute('data-poem-transition');
    this.poemButton.removeAttribute('data-corner-bounce');
    this.content.style.removeProperty('transition');
    this.content.style.removeProperty('width');
    this.content.style.removeProperty('height');
  }

  private applyPoem(poem?: Poem): void {
    const text = poem?.text || '';
    if (text !== this.displayedPoemText) this.setPoemSegments(text);
    this.displayedPoemText = poem?.text || '';
    this.displayedAttribution = poem?.attribution || '';
    const label = getString(poem ? 'chat-empty-next-poem' : 'chat-empty-retry-poem');
    this.poemButton.title = label;
    this.poemButton.setAttribute('aria-label', label);
    this.sourceRow.hidden = !poem?.attribution;
    this.sourceText.hidden = !!poem?.sourceUrl;
    this.sourceLink.hidden = !poem?.sourceUrl;
    if (poem?.sourceUrl) {
      this.sourceLink.href = poem.sourceUrl;
      this.sourceLink.textContent = poem.attribution;
      this.sourceLink.title = getString('chat-empty-open-source');
    } else {
      this.sourceLink.removeAttribute('href');
      this.sourceText.textContent = poem?.attribution || '';
    }
    this.fitLayout();
  }

  private transitionToPoem(poem: Poem, bounceCorner: boolean): void {
    this.transitionTarget = poem.text;
    this.poemButton.disabled = true;
    const before = this.content.getBoundingClientRect();
    this.content.style.width = `${before.width}px`;
    this.content.style.height = `${before.height}px`;
    this.root.setAttribute('data-poem-transition', 'exit');
    this.exitTimer = setTimeout(() => {
      this.exitTimer = undefined;
      if (this.root.hidden || !this.root.isConnected) {
        this.stopTransition();
        return;
      }
      this.root.setAttribute('data-poem-transition', 'morph');
      this.content.style.transition = 'none';
      this.content.style.width = 'fit-content';
      this.content.style.height = 'auto';
      this.applyPoem(poem);
      const after = this.content.getBoundingClientRect();
      this.content.style.width = `${before.width}px`;
      this.content.style.height = `${before.height}px`;
      void this.content.offsetWidth;
      this.content.style.removeProperty('transition');
      this.content.style.width = `${after.width}px`;
      this.content.style.height = `${after.height}px`;
      this.morphTimer = setTimeout(() => {
        this.morphTimer = undefined;
        if (this.root.hidden || !this.root.isConnected) {
          this.stopTransition();
          return;
        }
        this.content.style.removeProperty('width');
        this.content.style.removeProperty('height');
        this.root.setAttribute('data-poem-transition', 'reveal');
        if (bounceCorner) this.poemButton.setAttribute('data-corner-bounce', 'true');
        this.finishTimer = setTimeout(() => {
          this.stopTransition();
          this.render();
        }, 680);
      }, POEM_MORPH_MS);
    }, 170);
  }

  setSession(session: Session): void {
    const nextKey = session.conversationId || session.id;
    if (this.key && this.key !== nextKey) this.stopTransition();
    const revision = getPoemState(nextKey).revision;
    if (this.key !== nextKey || revision < this.seenRevision) this.seenRevision = revision;
    this.session = session;
    this.key = nextKey;
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const session = this.session;
    const visible = !!session && session.id !== '__skin-preview__' && !session.persistedTurns.length && !this.keyForContainer.childNodes.length;
    this.root.hidden = !visible;
    if (!visible) {
      this.stopTransition();
      return;
    }
    this.render();
    if (isChineseLocale()) requestPoem(this.key, false);
  }

  render(): void {
    if (this.root.hidden) return;
    const chinese = isChineseLocale();
    this.greeting.hidden = chinese;
    this.poemButton.hidden = !chinese;
    if (!chinese) {
      this.sourceRow.hidden = true;
      return;
    }

    const state = getPoemState(this.key);
    const poem = state.poem;
    const previousText = this.displayedPoemText;
    const changedByRequest = state.revision > this.seenRevision;
    if (changedByRequest) this.seenRevision = state.revision;
    this.poemButton.disabled = !!state.pending || !!this.transitionTarget;
    if (this.transitionTarget) return;
    const reducedMotion = this.root.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
    if (poem?.text && !state.pending && changedByRequest && poem.text !== previousText && !reducedMotion) {
      this.transitionToPoem(poem, state.lastRequestClicked);
      return;
    }
    this.applyPoem(poem);
  }

  dispose(): void {
    this.stopTransition();
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    views.delete(this);
    this.root.remove();
  }
}

const mounted = new WeakMap<HTMLElement, ChatEmptyState>();

export function mountChatEmptyState(doc: Document, container: HTMLElement, shell: HTMLElement): () => void {
  const view = new ChatEmptyState(doc, container, shell);
  mounted.set(container, view);
  return () => {
    mounted.delete(container);
    view.dispose();
  };
}

export function syncChatEmptyState(session: Session, container: HTMLElement): void {
  mounted.get(container)?.setSession(session);
}

/** Translation sessions have no conversation ID, so clearing one needs a fresh poem. */
export function resetChatEmptyState(session: Session): void {
  const key = session.conversationId || session.id;
  poems.delete(key);
  for (const view of views) {
    if (view.key === key) view.setSession(session);
  }
}
