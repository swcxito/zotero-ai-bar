import { assert } from 'chai';
import {
  buildQwenMtPrompt,
  isJsonResponseFormatCompatibilityError,
  isQwenMtModel,
  mergeQwenMtStreamChunks,
  mergePromptCacheProviderOptions,
  qwenMtUsesIncrementalOutput,
} from '../src/modules/llm';

describe('LLM compatibility helpers', function () {
  describe('prompt cache provider options', function () {
    it('adds a stable OpenAI key without disturbing existing options', function () {
      const result = mergePromptCacheProviderOptions({ openai: { reasoningEffort: 'high' } }, 'openai', 'conversation:openai:model');
      assert.deepEqual(result.openai, { reasoningEffort: 'high', promptCacheKey: 'conversation:openai:model' });
    });

    it('merges Anthropic cache control without overwriting thinking', function () {
      const result = mergePromptCacheProviderOptions({ anthropic: { thinking: { type: 'enabled', budgetTokens: 8000 } } }, 'anthropic', 'key');
      assert.deepEqual(result.anthropic.thinking, { type: 'enabled', budgetTokens: 8000 });
      assert.deepEqual(result.anthropic.cacheControl, { type: 'ephemeral' });
    });

    it('does not send cache parameters to incompatible providers', function () {
      const original = { google: { thinkingConfig: { thinkingBudget: 1000 } } };
      assert.deepEqual(mergePromptCacheProviderOptions(original, 'google', 'key'), original);
    });
  });

  describe('translation response-format compatibility', function () {
    it('falls back when a provider reports response_format as temporarily unavailable', function () {
      assert.isTrue(
        isJsonResponseFormatCompatibilityError(
          Object.assign(new Error('This response_format type is unavailable now'), { statusCode: 400, name: 'AI_APICallError' })
        )
      );
    });

    it('does not hide unrelated provider errors', function () {
      assert.isFalse(isJsonResponseFormatCompatibilityError(new Error('Authentication failed')));
    });
  });

  describe('Qwen-MT routing', function () {
    it('recognizes Qwen-MT variants as user-only translation models', function () {
      assert.isTrue(isQwenMtModel({ modelId: 'qwen-mt-plus' }));
      assert.isTrue(isQwenMtModel({ modelId: 'Qwen-MT-flash' }));
      assert.isFalse(isQwenMtModel({ modelId: 'qwen-plus' }));
    });

    it('distinguishes cumulative Plus/Turbo chunks from incremental Flash/Lite chunks', function () {
      assert.isFalse(qwenMtUsesIncrementalOutput({ modelId: 'qwen-mt-plus' }));
      assert.isFalse(qwenMtUsesIncrementalOutput({ modelId: 'qwen-mt-turbo' }));
      assert.isTrue(qwenMtUsesIncrementalOutput({ modelId: 'qwen-mt-flash' }));
      assert.isTrue(qwenMtUsesIncrementalOutput({ modelId: 'qwen-mt-lite' }));
    });

    it('detects cumulative and incremental chunks from their runtime shape', function () {
      assert.deepEqual(mergeQwenMtStreamChunks(['为了', '为了计算', '为了计算电荷'], true), {
        mode: 'replace',
        text: '为了计算电荷',
      });
      assert.deepEqual(mergeQwenMtStreamChunks(['为了', '计算', '电荷'], false), {
        mode: 'append',
        text: '为了计算电荷',
      });
    });

    it('puts locale-based target languages in the prompt instead of request options', function () {
      const prompt = buildQwenMtPrompt('zh-CN', 'Translate me');
      assert.include(prompt, 'Chinese');
      assert.include(prompt, '(zh-CN)');
      assert.include(prompt, 'Translate me');
      assert.notInclude(prompt, 'translation_options');
    });
  });
});
