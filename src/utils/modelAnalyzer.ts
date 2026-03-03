import { config } from "../../package.json";
import { ModelIcons } from "../components/common";

/**
 * Extracts model family, type, and version from a model ID string based on common naming conventions.
 */
export interface ModelAnalysisResult {
  family: string;
  type: string;
  version: string;
}

const TYPE_KEYWORDS = new Set([
  "opus",
  "sonnet",
  "haiku",
  "coder",
  "chat",
  "instruct",
  "pro",
  "ultra",
  "flash",
  "fast",
  "turbo",
  "lite",
  "max",
  "plus",
  "her",
  "base",
  "large",
  "medium",
  "small",
  "tiny",
  "mini",
  "micro",
  "nano",
  "thinking",
  "codex",
  "code",
  "flashx",
  "highspeed",
]);

const IGNORED_KEYWORDS = new Set([
  "next",
  "preview",
  "beta",
  "alpha",
  "rc",
  "stable",
  "release",
  "latest",
  "v",
  "version",
  "final",
  "experiment",
  "experimental",
  "free",
]);

export function analyzeModelName(modelName: string): ModelAnalysisResult {
  // 0. Remove prefix (everything before last /)
  const baseId = modelName.split("/").pop() || modelName;

  // 1. Normalization
  const normalizedId = baseId.toLowerCase();

  // 2. Splitting (split by -, _, :, space). EXCLUDE dot.
  const rawTokens = normalizedId.split(/[-_: ]+/).filter(Boolean);

  // Refine tokens to handle dots and sizes
  const tokens: string[] = [];
  for (const token of rawTokens) {
    // Size pattern: 7b, 1.2b. Keep whole to ignore later
    if (/^\d+(\.\d+)?[bB]$/.test(token)) {
      tokens.push(token);
      continue;
    }

    // Version patterns: Keep whole
    if (
      /^\d+(\.\d+)*$/.test(token) ||
      /^v\d+(\.\d+)*$/.test(token) ||
      /^[a-z]\d+(\.\d+)*$/.test(token)
    ) {
      tokens.push(token);
    } else if (token.includes(".")) {
      // Split by dot if it doesn't look like a version/size
      tokens.push(...token.split("."));
    } else {
      tokens.push(token);
    }
  }

  // 3. Extract Family
  // Heuristic: First token is family.
  // Check if it ends in a number (e.g. qwen3, gpt4)
  let family = tokens[0];
  const versionParts: string[] = [];

  // Try to extract version from family name if it ends with digits (e.g. qwen3 -> qwen, 3)
  // But check that matches generic pattern name+number.
  const familyMatch = family.match(/^([a-z]+)(\d+(\.\d+)?)$/);

  if (familyMatch) {
    family = familyMatch[1];
    if (familyMatch[2]) {
      versionParts.push(familyMatch[2]);
    }
  }

  let type = "";

  // 4. Process remaining tokens
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    // Check for Ignored
    if (IGNORED_KEYWORDS.has(token)) {
      continue;
    }

    // Check for Size (ignore) e.g. 7b, 1.2b
    if (/^\d+(\.\d+)?[bB]$/.test(token)) {
      continue;
    }

    // Check for Type
    if (TYPE_KEYWORDS.has(token)) {
      // Prefer the first found type or overwrite?
      // In names like "flash-lite", maybe we want "flash" or "lite"?
      // Let's assume the most significant type is usually explicitly part of the name.
      // Overwriting allows capturing "pro" in "gemini-1.5-pro".
      type = token;
      continue;
    }

    // Check for Version patterns

    // Pattern: v2, v3.5 (split might separate 5)
    const vMatch = token.match(/^v(\d+(\.\d+)*)$/);
    if (vMatch) {
      versionParts.push(vMatch[1]);
      continue;
    }

    // Pattern: number (integer or float)
    if (/^\d+(\.\d+)*$/.test(token)) {
      const numVal = parseFloat(token);
      // Heuristic: Large integers are dates/identifiers, skip.
      // Integers < 100 or numbers with decimals are versions.
      if (token.includes(".") || numVal < 100) {
        versionParts.push(token);
      }
      continue;
    }

    // Pattern: Letter + Number (common in versions like k2.5, m2, r1)
    if (/^[a-z]\d+(\.\d+)*$/.test(token)) {
      versionParts.push(token);
      continue;
    }
  }

  // 5. Construct Version
  const version = versionParts.join(".");

  return { family, type, version };
}

/**
 * Get the Chrome path for a model icon.
 * Icons are located in content/icons/models.
 * Exception: ChatGPT models use content/icons/openai.svg
 *
 * @param family The model family name
 * @returns Chrome URL path to the model icon
 */
export function getModelIconPath(family: string): string {
  const normalizedFamily = family.toLowerCase();

  return ModelIcons.get(normalizedFamily) || "";
}
