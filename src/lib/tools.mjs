// The site's tools in menu order: converters (from pairs.mjs), editors and viewers, and the format guides.
export { PAIRS, GROUPS, pairBySlug } from './pairs.mjs';
export { GUIDES } from './guides.mjs';

export const EDITORS = [
  { slug: 'json-editor', name: 'JSON Editor', blurb: 'Format, minify, sort keys and validate JSON, with JSON Schema checks (drafts 07 and 2020-12).' },
  { slug: 'xml-editor', name: 'XML Editor', blurb: 'Check that XML is well-formed, with the line and column of the first error. Format or minify it.' },
  { slug: 'yaml-editor', name: 'YAML Editor', blurb: 'Validate YAML 1.2, format it, handle several documents and view the data as JSON.' },
  { slug: 'csv-viewer', name: 'CSV Viewer', blurb: 'Open a CSV or TSV file as a sortable table, with row and column counts and the detected delimiter.' },
];
