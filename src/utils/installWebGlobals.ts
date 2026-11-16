/** No imports or closed-over constants: the build serializes this function before SDK evaluation. */
export function installWebGlobals(target: any, sourceWindow: any): void {
  if (!sourceWindow) return;
  for (const name of [
    'console',
    'TransformStream',
    'ReadableStream',
    'WritableStream',
    'TextEncoder',
    'TextDecoder',
    'TextDecoderStream',
    'DOMException',
    'AbortController',
    'AbortSignal',
    'window',
    'Node',
    'Element',
    'HTMLElement',
    'ShadowRoot',
    'CSS',
    'ResizeObserver',
    'IntersectionObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    if (typeof target[name] === 'undefined' && sourceWindow[name]) {
      target[name] = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name)
        ? sourceWindow[name].bind(sourceWindow)
        : sourceWindow[name];
    }
  }
}
