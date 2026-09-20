import { ModelIcons } from '../components/common';

/**
 * Extracts model family, type, and version from a model ID string based on common naming conventions.
 */
export interface ModelAnalysisResult {
  family: string;
  type: string;
  version: string;
  /** Tokens between the model version and its final type suffix, kept for display. */
  variantParts: string[];
  /** The final type suffix and any trailing modifiers, kept in source order for display. */
  typeParts: string[];
}

const TYPE_KEYWORDS = new Set([
  'opus',
  'sonnet',
  'haiku',
  'coder',
  'chat',
  'instruct',
  'pro',
  'ultra',
  'flash',
  'fast',
  'turbo',
  'lite',
  'max',
  'plus',
  'her',
  'base',
  'large',
  'medium',
  'small',
  'tiny',
  'mini',
  'micro',
  'nano',
  'thinking',
  'codex',
  'code',
  'flashx',
  'highspeed',
  'fable',
  'astra',
  'sol',
  'terra',
  'luna',
  'ocr',
]);

const IGNORED_KEYWORDS = new Set([
  'next',
  'preview',
  'beta',
  'alpha',
  'rc',
  'stable',
  'release',
  'latest',
  'v',
  'version',
  'final',
  'experiment',
  'experimental',
  'free',
  'exp',
]);

interface ModelToken {
  value: string;
  label: string;
}

function isSizeToken(token: string): boolean {
  return /^\d+(\.\d+)?[bB]$/.test(token);
}

function getVersionPart(token: string): string | undefined {
  const vMatch = token.match(/^v(\d+(\.\d+)*)$/);
  if (vMatch) return vMatch[1];

  if (/^\d+(\.\d+)*$/.test(token)) {
    const numVal = parseFloat(token);
    // Large integers are usually dates or provider identifiers rather than versions.
    if (token.includes('.') || numVal < 100) return token;
    return undefined;
  }

  if (/^[a-z]\d+(\.\d+)*$/.test(token)) return token;
  return undefined;
}

export function analyzeModelName(modelName: string | undefined | null): ModelAnalysisResult {
  const safeModelName = typeof modelName === 'string' ? modelName.trim() : '';
  if (!safeModelName) {
    return { family: 'custom', type: '', version: '', variantParts: [], typeParts: [] };
  }

  // 0. Remove prefix (everything before last /)
  const baseId = safeModelName.split('/').pop() || safeModelName;

  // 2. Splitting (split by -, _, :, space). EXCLUDE dot.
  const rawTokens = baseId.split(/[-_: ]+/).filter(Boolean);

  // Refine tokens to handle dots and sizes
  const tokens: ModelToken[] = [];
  const pushToken = (value: string, label: string) => tokens.push({ value: value.toLowerCase(), label });

  for (const rawToken of rawTokens) {
    const token = rawToken.toLowerCase();
    // Size pattern: 7b, 1.2b. Keep whole to ignore later
    if (/^\d+(\.\d+)?[bB]$/.test(token)) {
      pushToken(token, rawToken);
      continue;
    }

    // Version patterns: Keep whole
    if (/^\d+(\.\d+)*$/.test(token) || /^v\d+(\.\d+)*$/.test(token) || /^[a-z]\d+(\.\d+)*$/.test(token)) {
      pushToken(token, rawToken);
    } else if (token.includes('.')) {
      // Split by dot if it doesn't look like a version/size
      rawToken.split('.').forEach((part) => pushToken(part, part));
    } else {
      pushToken(token, rawToken);
    }
  }

  // 3. Extract Family
  // Heuristic: First token is family.
  // Check if it ends in a number (e.g. qwen3, gpt4)
  let family = tokens[0].value;
  const versionParts: string[] = [];
  const versionTokenIndices = new Set<number>();

  // Try to extract version from family name if it ends with digits (e.g. qwen3 -> qwen, 3)
  // But check that matches generic pattern name+number.
  const familyMatch = family.match(/^([a-z]+)(\d+(\.\d+)?)$/);

  if (familyMatch) {
    family = familyMatch[1];
    if (familyMatch[2]) {
      versionParts.push(familyMatch[2]);
      versionTokenIndices.add(0);
    }
  }

  // 4. Collect version tokens before classifying the remaining fields. This lets
  // us distinguish `claude-opus-4-6` from `qwen3-coder-flash` without knowing
  // anything about a particular model family.
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i].value;
    if (IGNORED_KEYWORDS.has(token) || isSizeToken(token)) continue;

    const versionPart = getVersionPart(token);
    if (versionPart !== undefined) {
      versionParts.push(versionPart);
      versionTokenIndices.add(i);
    }
  }

  // The last known type keyword is the classic suffix. Everything between the
  // version and that suffix is retained as a family-agnostic variant, so new
  // fields such as `ASR`, `VL`, or `Omni` do not need to be added to a list.
  const typeCandidateIndices: number[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i].value;
    if (!IGNORED_KEYWORDS.has(token) && !isSizeToken(token) && !versionTokenIndices.has(i) && TYPE_KEYWORDS.has(token)) {
      typeCandidateIndices.push(i);
    }
  }

  const primaryTypeIndex = typeCandidateIndices.at(-1);
  const type = primaryTypeIndex === undefined ? '' : tokens[primaryTypeIndex].value;
  const variantStartIndex = versionTokenIndices.size > 0 ? Math.max(...versionTokenIndices) + 1 : 1;
  const variantParts: string[] = [];
  const typeParts: string[] = [];

  for (let i = variantStartIndex; i < tokens.length; i++) {
    const token = tokens[i].value;
    if (IGNORED_KEYWORDS.has(token) || isSizeToken(token) || versionTokenIndices.has(i)) continue;

    if (primaryTypeIndex === undefined || i < primaryTypeIndex) {
      variantParts.push(tokens[i].label);
    } else {
      typeParts.push(tokens[i].label);
    }
  }

  // A type that appears before an explicit numeric version (e.g. `claude-opus-4`)
  // still belongs to the type display even though it is outside the loop above.
  if (primaryTypeIndex !== undefined && typeParts.length === 0) {
    typeParts.push(tokens[primaryTypeIndex].label);
  } else if (primaryTypeIndex !== undefined && primaryTypeIndex < variantStartIndex) {
    typeParts.unshift(tokens[primaryTypeIndex].label);
  }

  // 5. Construct Version
  const version = versionParts.join('.');

  return { family, type, version, variantParts, typeParts };
}

/**
 * Get the Chrome path for a model icon.
 * Icons are located in content/icons/models.
 * Exception: ChatGPT models use content/icons/openai.svg
 *
 * @param family The model family name
 * @returns Chrome URL path to the model icon
 */
export function getModelIconPath(family?: string): string {
  if (!family) return ModelIcons.custom;
  const normalizedFamily = family.toLowerCase();

  if (ModelIcons[normalizedFamily]) return ModelIcons[normalizedFamily];

  // GPT o-series: o1, o3, o4-mini, o-pro → OpenAI icon
  if (normalizedFamily === 'o' || normalizedFamily.startsWith('o-')) {
    return ModelIcons.gpt;
  }

  // Try progressively shorter prefixes for sub-families (e.g. "claude-sonnet" → "claude")
  let lastDash = normalizedFamily.lastIndexOf('-');
  while (lastDash > 0) {
    const prefix = normalizedFamily.slice(0, lastDash);
    if (ModelIcons[prefix]) return ModelIcons[prefix];
    lastDash = normalizedFamily.lastIndexOf('-', lastDash - 1);
  }

  return ModelIcons.custom;
}
