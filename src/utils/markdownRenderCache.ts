/** Shared character budget for a response's math and code LRU caches. */
export function createMarkdownRenderCache() {
  const entries = new Map<string, { kind: 'math' | 'code'; value: string }>();
  let characters = 0;
  const counts = { math: 0, code: 0 };
  const remove = (key: string) => {
    const entry = entries.get(key)!;
    characters -= key.length + entry.value.length;
    counts[entry.kind]--;
    entries.delete(key);
  };
  return {
    getOrRender(kind: 'math' | 'code', input: string, render: () => string): string {
      const key = `${kind}:${input}`;
      const hit = entries.get(key);
      if (hit) {
        entries.delete(key);
        entries.set(key, hit);
        return hit.value;
      }
      const value = render();
      const size = key.length + value.length;
      if (size > 1_000_000) return value;
      while (counts[kind] >= 128) {
        const oldest = [...entries].find(([, entry]) => entry.kind === kind)![0];
        remove(oldest);
      }
      while (characters + size > 1_000_000) remove(entries.keys().next().value!);
      entries.set(key, { kind, value });
      counts[kind]++;
      characters += size;
      return value;
    },
  };
}
