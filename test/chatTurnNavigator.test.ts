import { assert } from 'chai';
import {
  CHAT_TURN_NAVIGATOR_MIN_WIDTH,
  getActiveTurnIndex,
  getCenteredMarkerPositions,
  getHoverMarkerWidth,
  getMarkerHitIndex,
  pairChatTurnRoles,
} from '../src/components/chatTurnNavigator';

describe('chatTurnNavigator', function () {
  it('uses the wider visibility threshold', function () {
    assert.equal(CHAT_TURN_NAVIGATOR_MIN_WIDTH, 520);
  });

  it('pairs user and assistant nodes into turns while preserving incomplete turns', function () {
    assert.deepEqual(pairChatTurnRoles(['user', 'assistant', 'user', 'assistant']), [
      { userIndex: 0, assistantIndex: 1 },
      { userIndex: 2, assistantIndex: 3 },
    ]);
    assert.deepEqual(pairChatTurnRoles(['assistant', 'user', 'assistant', 'user']), [
      { assistantIndex: 0 },
      { userIndex: 1, assistantIndex: 2 },
      { userIndex: 3 },
    ]);
  });

  it('centers markers with a fixed gap and only compresses dense groups', function () {
    assert.deepEqual(getCenteredMarkerPositions(0, 100, 10, 10), []);
    assert.deepEqual(getCenteredMarkerPositions(1, 100, 10, 10), [50]);
    assert.deepEqual(getCenteredMarkerPositions(3, 100, 10, 10), [40, 50, 60]);

    const dense = getCenteredMarkerPositions(100, 60, 10, 10);
    assert.lengthOf(dense, 100);
    assert.equal(dense[0], 10);
    assert.equal(dense.at(-1), 50);
    assert.isTrue(dense.every((position, index) => index === 0 || position > dense[index - 1]));
  });

  it('shrinks marker widths with distance from the hovered turn', function () {
    assert.equal(getHoverMarkerWidth(4, 4), 26);
    assert.equal(getHoverMarkerWidth(3, 4), 20);
    assert.equal(getHoverMarkerWidth(2, 4), 14);
    assert.equal(getHoverMarkerWidth(1, 4), 8);
    assert.equal(getHoverMarkerWidth(0, 4), 8);
  });

  it('maps gaps to the nearest marker but ignores space outside the marker group', function () {
    const positions = [40, 50, 60];
    assert.equal(getMarkerHitIndex(positions, 40), 0);
    assert.equal(getMarkerHitIndex(positions, 53), 1);
    assert.equal(getMarkerHitIndex(positions, 45), 0);
    assert.equal(getMarkerHitIndex(positions, 55), 1);
    assert.equal(getMarkerHitIndex(positions, 20), -1);
    assert.equal(getMarkerHitIndex(positions, 80), -1);
  });

  it('selects the turn near the upper reading probe and locks to the last turn at the bottom', function () {
    const offsets = [0, 420, 920];
    assert.equal(getActiveTurnIndex(offsets, 0, 600, 1500), 0);
    assert.equal(getActiveTurnIndex(offsets, 350, 600, 1500), 1);
    assert.equal(getActiveTurnIndex(offsets, 900, 600, 1500), 2);
    assert.equal(getActiveTurnIndex([], 0, 600, 600), -1);
  });
});
