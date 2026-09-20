import { analyzeModelName } from '../src/utils/modelAnalyzer';

const testCases = [
  {
    in: '',
    out: { family: 'custom', type: '', version: '' },
  },
  {
    in: 'claude-opus-4-6',
    out: { family: 'claude', type: 'opus', version: '4.6' },
  },
  {
    in: 'qwen3-coder-next',
    out: { family: 'qwen', type: 'coder', version: '3' },
  },
  {
    in: 'riverflow-v2-fast',
    out: { family: 'riverflow', type: 'fast', version: '2' },
  },
  { in: 'kimi-k2.5', out: { family: 'kimi', type: '', version: 'k2.5' } },
  {
    in: 'minimax-m2-her',
    out: { family: 'minimax', type: 'her', version: 'm2' },
  },
  {
    in: 'qwen-flash-260101',
    out: { family: 'qwen', type: 'flash', version: '' },
  },
  { in: 'gpt-5.2', out: { family: 'gpt', type: '', version: '5.2' } },
  {
    in: 'gemini-3-pro-preview',
    out: { family: 'gemini', type: 'pro', version: '3' },
  },
  {
    in: 'openrouter/pony-alpha',
    out: { family: 'pony', type: '', version: '' },
  },
  {
    in: 'anthropic/claude-opus-4.6',
    out: { family: 'claude', type: 'opus', version: '4.6' },
  },
  {
    in: 'stepfun/step-3.5-flash:free',
    out: { family: 'step', type: 'flash', version: '3.5' },
  },
  {
    in: 'liquid/lfm-2.5-1.2b-thinking:free',
    out: { family: 'lfm', type: 'thinking', version: '2.5' },
  },
  { in: 'palmyra-x5', out: { family: 'palmyra', type: '', version: 'x5' } },
  {
    in: 'gpt-5.2-codex',
    out: { family: 'gpt', type: 'codex', version: '5.2' },
  },
  {
    in: 'x-ai/grok-code-fast-1',
    out: { family: 'grok', type: 'fast', version: '1' },
  },
  {
    in: 'Qwen3-ASR-Flash',
    out: { family: 'qwen', type: 'flash', version: '3', variantParts: ['ASR'], typeParts: ['Flash'] },
  },
  {
    in: 'Qwen3-Omni-Flash-Realtime',
    out: { family: 'qwen', type: 'flash', version: '3', variantParts: ['Omni'], typeParts: ['Flash', 'Realtime'] },
  },
  {
    in: 'Qwen3-Mega-Flash',
    out: { family: 'qwen', type: 'flash', version: '3', variantParts: ['Mega'], typeParts: ['Flash'] },
  },
];

testCases.forEach((test) => {
  const result = analyzeModelName(test.in);
  const expected = test.out as typeof test.out & { variantParts?: string[]; typeParts?: string[] };
  const passed =
    result.family === expected.family &&
    result.type === expected.type &&
    result.version === expected.version &&
    (!expected.variantParts || JSON.stringify(result.variantParts) === JSON.stringify(expected.variantParts)) &&
    (!expected.typeParts || JSON.stringify(result.typeParts) === JSON.stringify(expected.typeParts));

  console.log(`Input: ${test.in}`);
  console.log(`Expected: ${JSON.stringify(test.out)}`);
  console.log(`Actual:   ${JSON.stringify(result)}`);
  console.log(`Passed:   ${passed ? 'YES' : 'NO'}`);
  console.log('---');
});
