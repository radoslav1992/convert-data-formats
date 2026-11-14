// XML editor: well-formedness check with line and column, format and minify (comments, CDATA and mixed
// content are kept). Draft key in local storage: "cdf-xml-draft".
import { initTextEditor } from './text-editor';
import { checkXml, formatXml, minifyXml } from '../lib/convert/xml.mjs';
import { formatCount } from './ui';

export function initXmlEditor(root: HTMLElement) {
  const indent = root.querySelector('[data-indent]') as HTMLSelectElement;
  const editor = initTextEditor(root, {
    tool: 'xml-editor',
    storageKey: 'cdf-xml-draft',
    ext: 'xml',
    mime: 'application/xml',
    check(text) {
      if (!text.trim()) return { ok: false, badge: 'Empty', message: 'The editor is empty. Paste XML, open a file or load the sample.' };
      const error = checkXml(text);
      if (error) return { ok: false, badge: 'Not well-formed', message: `Not well-formed. ${error.display}`, error };
      const elements = (text.match(/<[A-Za-z_:][^\s/>]*/g) ?? []).length;
      const root = /<([A-Za-z_:][^\s/>]*)/.exec(text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, ''))?.[1];
      return { ok: true, badge: 'Well-formed', message: `Well-formed XML: root element <${root}>, ${formatCount(elements)} element${elements === 1 ? '' : 's'}.` };
    },
  });
  const act = (fn: () => string, message: string) => {
    try { editor.replace(fn(), message); } catch { editor.validate(); }
  };
  root.querySelector('[data-format]')?.addEventListener('click', () => act(() => formatXml(editor.area.textarea.value, { indent: indent.value }), 'Formatted.'));
  root.querySelector('[data-minify]')?.addEventListener('click', () => act(() => minifyXml(editor.area.textarea.value), 'Minified.'));
}
