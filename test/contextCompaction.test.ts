import { assert } from 'chai';
import {
  calculateContextBudget,
  createCheckpointMessage,
  estimateTextTokens,
  planContextCompaction,
  sanitizeMessagesForCompaction,
} from '../src/modules/contextCompaction';

function rounds(count: number): any[] {
  return Array.from({ length: count }, (_, index) => [
    { role: 'user', content: `question-${index}` },
    { role: 'assistant', content: `answer-${index}` },
  ]).flat();
}

describe('contextCompaction', function () {
  it('uses the documented mixed ASCII/non-ASCII estimate and threshold buffer', function () {
    assert.equal(estimateTextTokens('abcd中文中'), 3);
    const below = calculateContextBudget({ messages: [{ role: 'user', content: 'a'.repeat(1000) } as any], contextLimit: 10000 });
    assert.isFalse(below.shouldCompact);
    const above = calculateContextBudget({ messages: [{ role: 'user', content: 'a'.repeat(30000) } as any], contextLimit: 10000 });
    assert.isTrue(above.shouldCompact);
    assert.equal(above.bufferTokens, 4096);
  });

  it('keeps configured complete rounds plus the current normal-mode request', function () {
    const messages = [...rounds(5), { role: 'user', content: 'current' }] as any[];
    const plan = planContextCompaction(messages, { mode: 'normal', contextRounds: 2, contextLimit: 32000 });
    assert.exists(plan);
    assert.equal(plan!.tail.filter((message) => message.role === 'user').length, 3);
    assert.equal((plan!.tail.at(-1) as any).content, 'current');
  });

  it('ignores contextRounds in Agent mode and never splits a tool block', function () {
    const largeRounds = rounds(4).map((message: any) =>
      message.role === 'assistant' ? { ...message, content: `${message.content} ${'x'.repeat(10000)}` } : message
    );
    const messages: any[] = [
      ...largeRounds,
      { role: 'user', content: 'agent task' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'x', toolName: 'read', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'x', toolName: 'read', output: 'result' }] },
    ];
    const low = planContextCompaction(messages, { mode: 'agent', contextRounds: 1, contextLimit: 16000 });
    const high = planContextCompaction(messages, { mode: 'agent', contextRounds: 64, contextLimit: 16000 });
    assert.deepEqual(low, high);
    assert.equal(low!.tail.at(-2)!.role, 'assistant');
    assert.equal(low!.tail.at(-1)!.role, 'tool');
  });

  it('uses only the previous checkpoint and newer head on subsequent compaction', function () {
    const messages = [createCheckpointMessage('old frozen summary'), ...rounds(4), { role: 'user', content: 'current' }] as any[];
    const plan = planContextCompaction(messages, { mode: 'normal', contextRounds: 1, contextLimit: 32000 });
    assert.equal(plan!.previousSummary, 'old frozen summary');
    assert.notInclude(JSON.stringify(plan!.head), 'old frozen summary');
  });

  it('removes media and caps old tool output only in the compaction copy', function () {
    const original: any[] = [
      {
        role: 'user',
        content: [
          { type: 'image', image: 'secret' },
          { type: 'text', text: 'question' },
        ],
      },
      { role: 'tool', content: 'x'.repeat(5000) },
    ];
    const sanitized = sanitizeMessagesForCompaction(original, 100);
    assert.notInclude(JSON.stringify(sanitized), 'secret');
    assert.isAbove((original[1].content as string).length, 100);
    assert.isBelow(JSON.stringify((sanitized[1] as any).content).length, 200);
  });
});
