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
  ]) {
    if (typeof target[name] === 'undefined' && sourceWindow[name]) target[name] = sourceWindow[name];
  }
}
