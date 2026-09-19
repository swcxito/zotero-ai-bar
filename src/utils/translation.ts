import { z } from 'zod';

const otherMeaningSchema = z.object({
  pos: z.string().min(1).describe('English part-of-speech abbreviation, such as n., v., adj., or adv.'),
  translatedText: z.array(z.string().min(1)).min(1).describe('One or more concise alternative meanings written in the requested target language.'),
});

const translationBaseSchema = z.object({
  originalText: z.string().optional(),
  translatedText: z.string().min(1).describe('The primary translation written in the requested target language.'),
  targetLanguage: z.string().optional(),
});

export const translationResultSchema = z.discriminatedUnion('textType', [
  translationBaseSchema.extend({
    textType: z.literal('word'),
    pronunciation: z.string().optional(),
    pos: z.string().optional().describe('English part-of-speech abbreviation, such as n., v., adj., or adv.'),
    explanation: z
      .string()
      .optional()
      .describe(
        'A concise target-language explanation only for a specialized, technical, idiomatic, non-literal, or otherwise context-dependent meaning; omit for ordinary dictionary meanings.'
      ),
    otherMeanings: z.array(otherMeaningSchema).optional(),
  }),
  translationBaseSchema.extend({
    textType: z.literal('abbreviation'),
    fullForm: z.string().min(1).describe('The unabbreviated source-language full form.'),
    explanation: z.string().min(1).describe('A concise explanation written in the requested target language.'),
  }),
  translationBaseSchema.extend({
    textType: z.literal('text').describe('General text; preserve list-like source structure as Markdown in translatedText.'),
  }),
]);

export type TranslationResult = z.infer<typeof translationResultSchema>;

const POS_ABBREVIATIONS: Record<string, string> = {
  n: 'n.',
  noun: 'n.',
  名词: 'n.',
  v: 'v.',
  verb: 'v.',
  动词: 'v.',
  vt: 'vt.',
  transitiveverb: 'vt.',
  verbtransitive: 'vt.',
  及物动词: 'vt.',
  vi: 'vi.',
  intransitiveverb: 'vi.',
  verbintransitive: 'vi.',
  不及物动词: 'vi.',
  adj: 'adj.',
  adjective: 'adj.',
  形容词: 'adj.',
  adv: 'adv.',
  adverb: 'adv.',
  副词: 'adv.',
  prep: 'prep.',
  preposition: 'prep.',
  介词: 'prep.',
  pron: 'pron.',
  pronoun: 'pron.',
  代词: 'pron.',
  conj: 'conj.',
  conjunction: 'conj.',
  连词: 'conj.',
  interj: 'interj.',
  interjection: 'interj.',
  感叹词: 'interj.',
  aux: 'aux.',
  auxiliary: 'aux.',
  auxiliaryverb: 'aux.',
  助动词: 'aux.',
  det: 'det.',
  determiner: 'det.',
  限定词: 'det.',
  num: 'num.',
  numeral: 'num.',
  number: 'num.',
  数词: 'num.',
  art: 'art.',
  article: 'art.',
  冠词: 'art.',
  modal: 'modal v.',
  modalverb: 'modal v.',
  情态动词: 'modal v.',
  phrasalverb: 'phr. v.',
  短语动词: 'phr. v.',
};

/** Normalize model-produced POS labels to compact English dictionary abbreviations. */
export function normalizePartOfSpeech(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parts = value.trim().split(/\s*[/,;|]\s*/);
  if (parts.length > 1) {
    const normalizedParts = parts.map(normalizeSinglePartOfSpeech).filter((part): part is string => Boolean(part));
    return normalizedParts.length === parts.length ? normalizedParts.join('/') : undefined;
  }
  return normalizeSinglePartOfSpeech(value);
}

function normalizeSinglePartOfSpeech(value: string): string | undefined {
  const key = value.toLowerCase().replace(/[.\s_()-]/g, '');
  return POS_ABBREVIATIONS[key];
}

export interface TranslationRequestMeta {
  selectedText: string;
  targetLanguage: string;
  /** Optional providerId::modelId used only for this translation request. */
  modelKey?: string;
}

const CJK_WORD_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{M}々〆ヵヶー]+$/u;
const LEXICAL_WORD_RE = /^[\p{L}\p{M}\p{N}]+(?:['’ʼ\-‐‑][\p{L}\p{M}\p{N}]+)*$/u;
const DICTIONARY_SEGMENTATION_SCRIPTS: ReadonlyArray<[RegExp, string, number]> = [
  [/\p{Script=Thai}/u, 'th', 8],
  [/\p{Script=Lao}/u, 'lo', 8],
  [/\p{Script=Khmer}/u, 'km', 12],
  [/\p{Script=Myanmar}/u, 'my', 9],
];

/**
 * Determine whether a selection is one lexical word without consulting a model.
 *
 * Space-delimited writing systems use a Unicode-aware token rule. CJK text and
 * scripts that normally omit spaces need their own branches: CJK accepts one
 * local word segment (plus compact four-character compounds), while Southeast
 * Asian scripts use the runtime's locale dictionary segmenter.
 */
export function isSingleWordSelection(text: string): boolean {
  const value = text.trim().normalize('NFC');
  if (!value || /\s/u.test(value) || !/\p{L}/u.test(value)) return false;

  if (CJK_WORD_RE.test(value)) {
    const segmentCount = countWordSegments(value, /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(value) ? 'ja' : 'zh');
    return segmentCount === 1 || Array.from(value).length <= 4;
  }

  // Reject sentence punctuation and symbols before dictionary segmentation;
  // Intl.Segmenter intentionally ignores them when reporting word-like parts.
  if (!LEXICAL_WORD_RE.test(value)) return false;

  for (const [script, locale, compactWordLimit] of DICTIONARY_SEGMENTATION_SCRIPTS) {
    if (script.test(value)) {
      // Firefox/ICU versions differ in which dictionaries they ship. Keep a
      // conservative script-specific fallback for common compact words.
      return countWordSegments(value, locale) === 1 || Array.from(value).length <= compactWordLimit;
    }
  }

  return true;
}

function countWordSegments(text: string, locale: string): number {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale: string,
        options: { granularity: 'word' }
      ) => {
        segment(input: string): Iterable<{ isWordLike?: boolean }>;
      };
    }
  ).Segmenter;
  if (!Segmenter) return 0;
  return Array.from(new Segmenter(locale, { granularity: 'word' }).segment(text)).filter((segment) => segment.isWordLike).length;
}

/** Resolve the per-request model override from deterministic settings and text classification. */
export function getTranslationModelKey(params: {
  selectedText: string;
  useAlternativeModel: boolean;
  useModelForWords: boolean;
  modelKey: string;
}): string | undefined {
  if (!params.useAlternativeModel || !params.modelKey) return undefined;
  if (!params.useModelForWords && isSingleWordSelection(params.selectedText)) return undefined;
  return params.modelKey;
}

export const TRANSLATION_SYSTEM_PROMPT = 'You are a dedicated translation engine.';

export function buildStructuredTranslationPrompt(targetLanguage: string): string {
  return [
    `Translate the selected content into ${targetLanguage}.`,
    'Classify the selected content as a single word, an abbreviation/acronym, or general text.',
    'Use the surrounding context only to disambiguate the translation.',
  ].join('\n');
}

/**
 * Best-effort repair for providers that wrap JSON in prose/Markdown despite
 * receiving a structured-output schema.
 */
export function repairTranslationResult(raw: string): TranslationResult | undefined {
  for (const candidate of getJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate);
      const result = normalizeTranslationResultCandidate(parsed);
      if (result) return result;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/**
 * Keep a usable translation card when optional dictionary fields are malformed.
 * Partial JSON commonly contains unfinished array entries; those entries must
 * not invalidate an otherwise complete translatedText.
 */
export function normalizeTranslationResultCandidate(value: unknown, originalText?: string): TranslationResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (originalText !== undefined) candidate.originalText = originalText;

  for (const key of ['originalText', 'targetLanguage', 'pronunciation', 'pos', 'explanation', 'fullForm']) {
    const field = candidate[key];
    if (field !== undefined && (typeof field !== 'string' || !field.trim())) delete candidate[key];
  }

  if (candidate.textType === 'word') {
    const normalizedPos = normalizePartOfSpeech(candidate.pos);
    if (normalizedPos) candidate.pos = normalizedPos;
    else delete candidate.pos;
  }

  if (Array.isArray(candidate.otherMeanings)) {
    const validMeanings = candidate.otherMeanings
      .map((meaning) => {
        if (!meaning || typeof meaning !== 'object') return undefined;
        const pos = typeof (meaning as any).pos === 'string' ? (meaning as any).pos.trim() : '';
        const translatedText = Array.isArray((meaning as any).translatedText)
          ? (meaning as any).translatedText
              .filter((text: unknown): text is string => typeof text === 'string' && Boolean(text.trim()))
              .map((text: string) => text.trim())
          : [];
        return pos && translatedText.length > 0 ? { pos, translatedText } : undefined;
      })
      .filter((meaning): meaning is { pos: string; translatedText: string[] } => Boolean(meaning));
    const normalizedMeanings = validMeanings
      .map((meaning) => ({ ...meaning, pos: normalizePartOfSpeech(meaning.pos) }))
      .filter((meaning): meaning is { pos: string; translatedText: string[] } => Boolean(meaning.pos));
    if (normalizedMeanings.length > 0) candidate.otherMeanings = normalizedMeanings;
    else delete candidate.otherMeanings;
  } else {
    delete candidate.otherMeanings;
  }

  const result = translationResultSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

/** Extract a readable translation without ever exposing a JSON envelope. */
export function extractTranslationFallback(raw: string): string | undefined {
  const trimmed = stripCodeFence(raw).trim();
  if (!trimmed) return undefined;

  for (const candidate of getJsonCandidates(trimmed)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && typeof parsed.translatedText === 'string' && parsed.translatedText.trim()) {
        return parsed.translatedText.trim();
      }
    } catch {
      // Keep looking for a readable non-JSON fallback.
    }
  }

  // Recover the completed translatedText field even when the surrounding
  // JSON object is truncated or otherwise invalid.
  const translatedTextMatch = trimmed.match(/"translatedText"\s*:\s*("(?:\\.|[^"\\])*")/);
  if (translatedTextMatch) {
    try {
      const translatedText = JSON.parse(translatedTextMatch[1]);
      if (typeof translatedText === 'string' && translatedText.trim()) return translatedText.trim();
    } catch {
      // Continue to the plain-text fallback rules below.
    }
  }

  // Do not leak malformed structured output into the chat UI.
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || /"(?:translatedText|textType|originalText)"\s*:/.test(trimmed)) return undefined;
  return trimmed;
}

function getJsonCandidates(raw: string): string[] {
  const stripped = stripCodeFence(raw).trim();
  const candidates = stripped ? [stripped] : [];
  const object = extractOutermostObject(stripped);
  if (object && object !== stripped) candidates.push(object);
  return candidates;
}

function stripCodeFence(raw: string): string {
  const match = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : raw;
}

function extractOutermostObject(raw: string): string | undefined {
  const start = raw.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return raw.slice(start, i + 1);
  }
  return undefined;
}
