import { grepInText } from '../src/utils/textSearch';
import { askUserSchema, grepSchema, readSchema, globSchema } from '../src/utils/agentSchemas';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  // grepInText
  const sampleText = `Introduction\nThis paper proposes a novel method.\nResults show 95% accuracy.\nConclusion`;

  let results = grepInText(sampleText, 'ACCURACY', false, 10);
  assert(results.length === 1 && results[0].line === 3, 'literal match case-insensitive');

  results = grepInText('a\na\na\na', 'a', false, 2);
  assert(results.length === 2, 'maxResults');

  results = grepInText(sampleText, 'xyz', false, 10);
  assert(results.length === 0, 'no match');

  results = grepInText(sampleText, '\\d+%', true, 10);
  assert(results.length === 1, 'regex match');

  results = grepInText('price is $5', '$5', false, 10);
  assert(results.length === 1, 'escape regex special chars');

  // askUserSchema
  let parsed = askUserSchema.safeParse({
    questions: [{ question: 'What do you want to do?', options: ['A', 'B'] }],
  });
  assert(parsed.success, 'valid single question');

  parsed = askUserSchema.safeParse({
    questions: Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}`, options: ['A', 'B'] })),
  });
  assert(!parsed.success, 'reject more than 5 questions');

  parsed = askUserSchema.safeParse({
    questions: [{ question: 'What?', options: ['A'] }],
  });
  assert(!parsed.success, 'reject too few options');

  // grepSchema
  assert(!grepSchema.safeParse({}).success, 'grep requires pattern');
  assert(grepSchema.safeParse({ pattern: 'test', useRegex: true, maxResults: 10 }).success, 'grep valid');
  assert(!grepSchema.safeParse({ pattern: 'test', maxResults: 100 }).success, 'grep maxResults above 50');

  // readSchema
  assert(!readSchema.safeParse({ includeFullText: true }).success, 'read requires itemId');
  assert(readSchema.safeParse({ itemId: 123, startOffset: 0, endOffset: 100 }).success, 'read valid offsets');
  assert(!readSchema.safeParse({ itemId: 123, startOffset: -1 }).success, 'read negative offset');

  // globSchema
  assert(!globSchema.safeParse({}).success, 'glob requires query');
  assert(!globSchema.safeParse({ query: 'x', limit: 0 }).success, 'glob limit 0');
  assert(globSchema.safeParse({ query: 'x', limit: 25 }).success, 'glob valid limit');
  assert(!globSchema.safeParse({ query: 'x', limit: 100 }).success, 'glob limit above 50');

  console.log('All agent tool tests passed.');
}

runTests();
