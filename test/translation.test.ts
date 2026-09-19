import { assert } from 'chai';
import { getTranslationModelKey, isSingleWordSelection } from '../src/utils/translation';

describe('translation routing', function () {
  describe('single-word detection', function () {
    it('recognizes words in space-delimited writing systems', function () {
      for (const word of ['translation', "don't", 'state-of-the-art', 'перевод', 'ترجمة', 'अनुवाद', '번역']) {
        assert.isTrue(isSingleWordSelection(word), word);
      }
    });

    it('recognizes compact CJK words without treating sentences as words', function () {
      for (const word of ['翻译', '人工智能', '人工知能', 'コンピューター']) {
        assert.isTrue(isSingleWordSelection(word), word);
      }
      assert.isFalse(isSingleWordSelection('今天天气很好'));
      assert.isFalse(isSingleWordSelection('今日は晴れです'));
    });

    it('uses dictionary segmentation for scripts that do not require spaces', function () {
      assert.isTrue(isSingleWordSelection('ภาษา'), 'Thai word');
      assert.isFalse(isSingleWordSelection('ฉันรักคุณ'), 'Thai phrase');
      assert.isTrue(isSingleWordSelection('ភាសាខ្មែរ'), 'Khmer word');
    });

    it('rejects phrases, punctuation, numbers, and symbols', function () {
      for (const text of ['two words', 'word.', '123', 'hello!', 'ภาษา!', '🙂']) {
        assert.isFalse(isSingleWordSelection(text), text);
      }
    });
  });

  describe('dedicated-model selection', function () {
    const base = {
      useAlternativeModel: true,
      useModelForWords: false,
      modelKey: 'provider::translator',
    };

    it('keeps single words on the default model unless explicitly enabled', function () {
      assert.isUndefined(getTranslationModelKey({ ...base, selectedText: 'translation' }));
      assert.equal(getTranslationModelKey({ ...base, selectedText: 'translation', useModelForWords: true }), base.modelKey);
    });

    it('uses the dedicated model for non-word translations', function () {
      assert.equal(getTranslationModelKey({ ...base, selectedText: 'Translate this sentence.' }), base.modelKey);
    });

    it('does not override the model when dedicated translation is disabled', function () {
      assert.isUndefined(getTranslationModelKey({ ...base, selectedText: 'Translate this sentence.', useAlternativeModel: false }));
    });
  });
});
