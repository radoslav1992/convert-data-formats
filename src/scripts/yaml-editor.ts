// YAML editor: YAML 1.2 validation with line and column, format (comments kept), several documents, and a
// live JSON view of the data. Draft key in local storage: "cdf-yaml-draft".
import { initTextEditor } from './text-editor';
import { parseYaml, formatYaml } from '../lib/convert/yaml.mjs';
import { serializeJson } from '../lib/convert/json.mjs';
import { showCode, copyText, announce } from './ui';
import { track } from '../lib/analytics';

export function initYamlEditor(root: HTMLElement) {
  const indent = root.querySelector('[data-indent]') as HTMLSelectElement;
  const multi = root.querySelector('[data-multi]') as HTMLSelectElement;
  const view = root.querySelector('[data-json-view-wrap] [data-code-view]') as HTMLElement;
  const viewStatus = root.querySelector('[data-json-status]') as HTMLElement;
  let json = '';
  const editor = initTextEditor(root, {
    tool: 'yaml-editor',
    storageKey: 'cdf-yaml-draft',
    ext: 'yaml',
    mime: 'application/yaml',
    check(text) {
      if (!text.trim()) return { ok: false, badge: 'Empty', message: 'The editor is empty. Paste YAML, open a file or load the sample.' };
      try {
        const { value, warnings, meta } = parseYaml(text, { multiDoc: multi.value as 'array' | 'first' });
        json = serializeJson(value).text;
        const docs = meta.documents > 1 ? `${meta.documents} documents` : 'one document';
        return { ok: true, badge: 'Valid YAML', message: `Valid YAML 1.2: ${docs}.`, notes: warnings.filter(w => !/documents \(separated/.test(w)) };
      } catch (error) {
        json = '';
        const e = error as { message: string; line?: number; column?: number; display?: string };
        return { ok: false, badge: 'Invalid YAML', message: `Invalid YAML. ${e.display ?? e.message}`, error: e };
      }
    },
    after(text, check) {
      if (check.ok) {
        showCode(view, json);
        view.classList.remove('stale');
        viewStatus.textContent = 'The data as JSON, updated as you type.';
      } else {
        view.classList.add('stale');
        viewStatus.textContent = text.trim() ? 'Not updated: fix the YAML error first.' : '';
      }
    },
  });
  multi.addEventListener('change', () => editor.validate());
  root.querySelector('[data-format]')?.addEventListener('click', () => {
    try { editor.replace(formatYaml(editor.area.textarea.value, { indent: indent.value }), 'Formatted.'); } catch { editor.validate(); }
  });
  root.querySelector('[data-copy-json]')?.addEventListener('click', async () => {
    const ok = json ? await copyText(json) : false;
    announce(root.querySelector('[data-status]') as HTMLElement, ok ? 'Copied the JSON.' : 'There is no valid JSON to copy.');
    if (ok) track('copy_output', { pair: 'yaml-editor-json' });
  });
}
