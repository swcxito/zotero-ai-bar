import { IconView } from './iconView';

/** Keep glyphs separate from the button background changed by chat skins. */
export function setButtonIcon(button: HTMLButtonElement, url: string): void {
  const props = IconView({ iconMarkup: url, sizeRem: 1 });
  const icon = ztoolkit.UI.createElement(button.ownerDocument, props.tag || 'img', props);
  (icon as HTMLElement).style.setProperty('-moz-context-properties', 'fill, stroke');
  (icon as HTMLElement).style.setProperty('fill', 'currentColor');
  (icon as HTMLElement).style.setProperty('stroke', 'currentColor');
  button.style.removeProperty('background-image');
  button.replaceChildren(icon);
}
