import type { ElementProps } from 'zotero-plugin-toolkit';

/** SVG names such as linearGradient and clipPath are case-sensitive. */
export function createSVGElement(doc: Document, tag: string, props: ElementProps): SVGElement {
  const element = doc.createElementNS('http://www.w3.org/2000/svg', tag) as SVGElement;
  if (props.id) element.id = props.id;
  if (props.styles) Object.assign(element.style, props.styles);
  if (props.properties) Object.assign(element, props.properties);
  for (const [name, value] of Object.entries(props.attributes ?? {})) {
    if (value !== undefined) element.setAttribute(name, String(value));
  }
  if (props.classList?.length) element.classList.add(...props.classList);
  for (const { type, listener, options } of props.listeners ?? []) {
    if (listener) element.addEventListener(type, listener, options);
  }
  for (const child of props.children ?? []) element.appendChild(createSVGElement(doc, child.tag, child));
  return element;
}
