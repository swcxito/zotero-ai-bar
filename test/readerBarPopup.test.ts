import { assert } from 'chai';
import { formatPopupActionLabel } from '../src/modules/readerBarPopup';

describe('readerBarPopup', function () {
  it('formats localized quick actions with locale-appropriate brackets', function () {
    assert.equal(formatPopupActionLabel('解释', 'zh-CN'), '【解释】');
    assert.equal(formatPopupActionLabel('Explain', 'en-US'), '[Explain]');
  });
});
