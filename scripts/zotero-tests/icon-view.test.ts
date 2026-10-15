import { assert } from 'chai';
import { Icons, ModelIcons } from '../../src/components/common';
import { IconView } from '../../src/components/iconView';
import { createImageViewer } from '../../src/components/imagePreview';

describe('SVG icons in native Zotero XHTML', function () {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  let doc: Document;
  let host: HTMLElement;
  let warnings: string[];
  let listener: { observe: (message: any) => void };

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    doc = Zotero.getMainWindow().document;
  });

  beforeEach(function () {
    warnings = [];
    listener = {
      observe(message: any) {
        if (String(message.message).includes('Removed unsafe')) warnings.push(message.message);
      },
    };
    Services.console.registerListener(listener);
    host = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    host.style.cssText = 'position:fixed;left:0;top:0;color:rgb(17,34,51)';
    doc.documentElement.appendChild(host);
  });

  afterEach(async function () {
    host.remove();
    await Zotero.Promise.delay(20);
    Services.console.unregisterListener(listener);
    assert.deepEqual(warnings, [], 'rendering icons must not trigger the native sanitizer');
  });

  function mount(markup: string) {
    return ztoolkit.UI.appendElement(IconView({ iconMarkup: markup }), host) as HTMLElement;
  }

  it('renders every bundled icon with its SVG structure and paint intact', function () {
    for (const [name, markup] of Object.entries({ ...Icons, ...ModelIcons })) {
      const wrapper = mount(markup);
      const svg = wrapper.firstElementChild as SVGSVGElement;
      const xml = markup.includes('xmlns=') ? markup : markup.replace('<svg', `<svg xmlns="${svgNamespace}"`);
      const reference = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement;
      const expected = [reference, ...reference.querySelectorAll('*')];
      const actual = [svg, ...svg.querySelectorAll('*')];
      assert.equal(actual.length, expected.length, name);
      for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i].namespaceURI, svgNamespace, name);
        assert.equal(actual[i].localName, expected[i].localName, name);
        for (const attr of expected[i].attributes) {
          if (attr.name === 'xmlns' || attr.name === 'style') continue;
          assert.equal(actual[i].getAttribute(attr.name), attr.value, `${name}: ${attr.name}`);
        }
        const expectedStyle = (expected[i] as SVGElement).style;
        for (const property of Array.from(expectedStyle)) {
          assert.equal((actual[i] as SVGElement).style.getPropertyValue(property), expectedStyle.getPropertyValue(property), `${name}: ${property}`);
        }
      }
      assert.isAbove(svg.getBBox().width, 0, `${name} must have visible geometry`);
      assert.isFalse(svg.hasAttribute('xmlns'), 'namespace is supplied by createElementNS');
      wrapper.remove();
    }
  });

  it('inherits theme colours while preserving fixed colours and gradients', function () {
    const wrapper = mount(Icons.Translate);
    const paths = wrapper.querySelectorAll('path');
    const fixedColour = wrapper.querySelector('path[stroke="#f87171"]')!;
    const computed = (element: Element) => doc.defaultView!.getComputedStyle(element);
    assert.equal(computed(paths[0]).stroke, 'rgb(17, 34, 51)');
    assert.equal(computed(fixedColour).stroke, 'rgb(248, 113, 113)');
    host.style.color = 'rgb(51, 102, 153)';
    assert.equal(computed(paths[0]).stroke, 'rgb(51, 102, 153)');
    assert.equal(computed(fixedColour).stroke, 'rgb(248, 113, 113)');
    const gradient = mount(ModelIcons.custom);
    assert.equal(gradient.querySelectorAll('linearGradient, radialGradient').length, 4);
    assert.equal(computed(gradient.querySelector('rect')!).fill, 'url("#zb-custom-b")');
    assert.equal(computed(gradient.querySelector('stop')!).stopColor, 'rgb(230, 110, 80)');
  });

  it('keeps SVG markup passive instead of admitting active or remote content', function () {
    const wrapper = mount(
      `<svg xmlns="${svgNamespace}" onload="throw 1"><script>throw 1</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject><image href="https://example.invalid/image"/><path d="M0 0L10 10" onclick="throw 1" fill="url(https://example.invalid/paint)" style="stroke:url(https://example.invalid/stroke); fill: url(#local)"/><title>Safe label</title></svg>`
    );
    assert.isNull(wrapper.querySelector('script, foreignObject, image'));
    assert.isNull(wrapper.querySelector('[onload], [onclick], [href]'));
    assert.isFalse(wrapper.querySelector('path')!.hasAttribute('fill'));
    assert.equal((wrapper.querySelector('path') as SVGElement).style.stroke, '');
    assert.equal((wrapper.querySelector('path') as SVGElement).style.fill, 'url("#local")');
    assert.equal(wrapper.querySelector('title')!.textContent, 'Safe label');
  });

  it('keeps image URLs on the image path and gallery arrows visible', function () {
    const image = mount('chrome://zaibar/content/icons/chat-history.svg');
    assert.equal(image.localName, 'img');
    assert.equal(image.getAttribute('src'), 'chrome://zaibar/content/icons/chat-history.svg');
    const viewer = createImageViewer(['data:image/png;base64,', 'data:image/png;base64,'], 0, host, doc);
    const arrows = viewer.overlay.querySelectorAll('button svg');
    assert.lengthOf(arrows, 2);
    for (const arrow of arrows) assert.equal(arrow.namespaceURI, svgNamespace);
    viewer.close();
  });
});
