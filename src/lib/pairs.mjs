// Every conversion page, driven from one list. Each pair's content (samples, rules, examples, option notes,
// errors, limits, FAQ) lives in src/lib/pairs/<slug>.mjs and is written for that pair alone; examples and
// error messages on the pages are produced at build time by the engine itself.
import { FORMATS, formatBySlug } from './convert/index.mjs';
import { optionsFor, pairDefaults, pairLabels } from './options.mjs';
import csvToJson from './pairs/csv-to-json.mjs';
import jsonToCsv from './pairs/json-to-csv.mjs';
import jsonToYaml from './pairs/json-to-yaml.mjs';
import yamlToJson from './pairs/yaml-to-json.mjs';
import jsonToXml from './pairs/json-to-xml.mjs';
import xmlToJson from './pairs/xml-to-json.mjs';
import xmlToCsv from './pairs/xml-to-csv.mjs';
import csvToXml from './pairs/csv-to-xml.mjs';
import excelToCsv from './pairs/excel-to-csv.mjs';
import csvToExcel from './pairs/csv-to-excel.mjs';
import excelToJson from './pairs/excel-to-json.mjs';
import jsonToExcel from './pairs/json-to-excel.mjs';
import jsonToToml from './pairs/json-to-toml.mjs';
import tomlToJson from './pairs/toml-to-json.mjs';
import tsvToCsv from './pairs/tsv-to-csv.mjs';
import csvToTsv from './pairs/csv-to-tsv.mjs';
import yamlToXml from './pairs/yaml-to-xml.mjs';
import xmlToYaml from './pairs/xml-to-yaml.mjs';

const CONTENT = [
  csvToJson, jsonToCsv, jsonToYaml, yamlToJson, jsonToXml, xmlToJson, xmlToCsv, csvToXml, excelToCsv,
  csvToExcel, excelToJson, jsonToExcel, jsonToToml, tomlToJson, tsvToCsv, csvToTsv, yamlToXml, xmlToYaml,
];

export const PAIRS = CONTENT.map(content => {
  const [a, b] = content.slug.split('-to-');
  const from = formatBySlug(a).id;
  const to = formatBySlug(b).id;
  const options = content.options ?? optionsFor(from, to);
  return {
    ...content,
    from,
    to,
    name: `${FORMATS[from].name} to ${FORMATS[to].name}`,
    reverseSlug: `${b}-to-${a}`,
    options,
    defaults: { ...pairDefaults(from, to), ...(content.defaults ?? {}) },
    labels: { ...pairLabels(from, to), ...(content.labels ?? {}) },
  };
});

export const pairBySlug = slug => PAIRS.find(pair => pair.slug === slug);

const group = (id, name, about, slugs) => ({ id, name, about, pairs: slugs.map(pairBySlug) });
export const GROUPS = [
  group('tables', 'Spreadsheets and tables', 'CSV, TSV and Excel to and from JSON, and between each other.', ['csv-to-json', 'json-to-csv', 'excel-to-csv', 'csv-to-excel', 'excel-to-json', 'json-to-excel', 'tsv-to-csv', 'csv-to-tsv']),
  group('config', 'JSON, YAML and TOML', 'Configuration and data files, both ways.', ['json-to-yaml', 'yaml-to-json', 'json-to-toml', 'toml-to-json']),
  group('xml', 'XML', 'XML to and from JSON, YAML and CSV.', ['json-to-xml', 'xml-to-json', 'xml-to-csv', 'csv-to-xml', 'yaml-to-xml', 'xml-to-yaml']),
];
