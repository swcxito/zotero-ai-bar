import { assert } from 'chai';
import { isJsonResponseFormatCompatibilityError, mergePromptCacheProviderOptions } from '../src/modules/llm';

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
});
