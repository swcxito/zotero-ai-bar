/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * iconView.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

import type { TagElementProps } from 'zotero-plugin-toolkit';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const svgTags = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'title',
  'desc',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
]);
const svgAttributes = new Set([
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'fx',
  'fy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'id',
  'class',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'preserveAspectRatio',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'color',
  'role',
  'aria-hidden',
  'aria-label',
  'focusable',
]);
const svgStyleProperties = new Set([
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'clip-path',
  'mask',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'line-height',
]);

// Keep paint references within the icon; never turn SVG markup into an active
// document or allow it to fetch external resources when creating DOM nodes.
function isLocalPaint(value: string): boolean {
  return (
    !Array.from(value).some((char) => char === '\\' || char.charCodeAt(0) < 32) &&
    !/url\s*\(/i.test(value.replace(/url\(\s*(['"]?)#[\w.-]+\1\s*\)/gi, ''))
  );
}

function svgElementProps(element: Element): TagElementProps | undefined {
  if (element.namespaceURI !== SVG_NAMESPACE || !svgTags.has(element.localName)) return undefined;
  const attributes: Record<string, string> = {};
  for (const attr of element.attributes) {
    if (!attr.namespaceURI && svgAttributes.has(attr.name) && isLocalPaint(attr.value)) attributes[attr.name] = attr.value;
  }
  // Preserve the bundled multicolour icons' paint styles without admitting
  // event handlers, links, foreignObject, scripts, or external CSS resources.
  const style = (element as SVGElement).style;
  const declarations: string[] = [];
  for (const name of Array.from(style)) {
    const value = style.getPropertyValue(name);
    if (svgStyleProperties.has(name) && isLocalPaint(value)) declarations.push(`${name}: ${value}`);
  }
  if (declarations.length) attributes.style = declarations.join('; ');
  return {
    tag: element.localName,
    namespace: 'svg',
    attributes,
    ...(element.localName === 'title' || element.localName === 'desc'
      ? { properties: { textContent: element.textContent } }
      : {
          children: Array.from(element.children)
            .map(svgElementProps)
            .filter((child): child is TagElementProps => !!child),
        }),
  };
}

function parseSVG(markup: string): TagElementProps {
  // xmlns is needed only by the detached XML parser. The toolkit subsequently
  // creates each live node with createElementNS, without setting innerHTML.
  const source = /\sxmlns\s*=/.test(markup) ? markup : markup.replace('<svg', `<svg xmlns="${SVG_NAMESPACE}"`);
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = parsed.documentElement;
  const props = root.localName === 'svg' ? svgElementProps(root) : undefined;
  if (!props) throw new Error('Invalid SVG icon markup');
  return props;
}

export interface IconViewProps {
  iconMarkup: string;
  sizeRem?: number;
  extraClasses?: string[];
}

export function IconView({ iconMarkup, sizeRem = 1, extraClasses = [] }: IconViewProps): TagElementProps {
  const trimmedMarkup = iconMarkup.trim();

  if (trimmedMarkup.startsWith('<svg')) {
    return {
      tag: 'span',
      namespace: 'html',
      styles: {
        width: `${sizeRem}rem`,
        height: `${sizeRem}rem`,
        fontSize: `${sizeRem}rem`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: '0',
        lineHeight: '0',
      },
      classList: extraClasses,
      children: [parseSVG(trimmedMarkup)],
    };
  }
  return {
    tag: 'img',
    namespace: 'html',
    styles: {
      width: `${sizeRem}rem`,
      height: `${sizeRem}rem`,
      pointerEvents: 'none',
      flexShrink: '0',
    },
    classList: extraClasses,
    properties: { src: iconMarkup },
  };
}
