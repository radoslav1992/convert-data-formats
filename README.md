# Convert Data Formats

**Free tools to convert, view, format and validate CSV, TSV, JSON, YAML, XML, TOML and Excel files, in the browser.**

The site at [convertdataformats.com](https://convertdataformats.com). Every tool runs in the visitor's browser:
files are read from their disk, converted on their device and never uploaded. No accounts, no ads.

## What is on the site

- **Home** (`/`): a universal converter. Paste, open or drop any supported file; the format is detected (or
  chosen by hand) and converted to any other. Below it, every tool, grouped.
- **Converters hub** (`/converters`): a from/to matrix and a grouped list with one sentence per converter.
- **18 conversion pages**, each at `/{a}-to-{b}`: csv-to-json, json-to-csv, json-to-yaml, yaml-to-json,
  json-to-xml, xml-to-json, xml-to-csv, csv-to-xml, excel-to-csv, csv-to-excel, excel-to-json, json-to-excel,
  json-to-toml, toml-to-json, tsv-to-csv, csv-to-tsv, yaml-to-xml, xml-to-yaml. Each has the tool with a sample
  already converted in the HTML, then the mapping rules, a worked example, every option with a mini example,
  common errors with the real messages, what is lost, an FAQ and links. All examples and messages on these
  pages are produced at build time by the same engine the tool uses.
- **Editors**: `/json-editor` (format, minify, sort keys, validation with line and column, JSON Schema with Ajv
  for drafts 07 and 2020-12, open, download, copy), `/xml-editor` (well-formedness with line and column, format,
  minify), `/yaml-editor` (YAML 1.2 validation with line and column, format, several documents, JSON view), and
  `/csv-viewer` (CSV or TSV as a sortable table with row and column counts and the detected delimiter).
- **Format guides**: `/formats` and `/formats/{csv,tsv,json,yaml,xml,toml,xlsx}`.
- `/about`, `/privacy` and a 404 page.

The old site's five addresses (`/`, `/json-editor`, `/xml-editor`, `/yaml-editor`, `/converters`) are kept with
exactly that spelling. No URL on the site ends in a slash: `trailingSlash: 'never'` and `build.format: 'file'`
in `astro.config.mjs`, and `"html_handling": "drop-trailing-slash"` in `wrangler.jsonc`. Every internal link,
canonical, sitemap entry and `llms.txt` line uses the no-slash form; `npm run check` fails otherwise.

## Project layout

| Path | What it is |
| --- | --- |
| `src/lib/convert/` | The engine: pure ES modules, importable in Node tests. `index.mjs` (`parse`, `serialize`, `convert`, `FORMATS`), `detect.mjs`, `csv.mjs`, `json.mjs`, `yaml.mjs`, `xml.mjs`, `toml.mjs`, `xlsx.mjs`, `table.mjs` (flattening and nesting), `infer.mjs` (type detection), `errors.mjs` (errors with line and column) |
| `src/lib/pairs.mjs`, `src/lib/pairs/<slug>.mjs` | The 18 conversion pages: one content file per pair (samples, rules, example, option notes, errors, limits, FAQ, related) |
| `src/lib/options.mjs` | Every converter option (label, control, default) and which options apply to which pair |
| `src/lib/guides.mjs` | The seven format guides |
| `src/lib/tools.mjs`, `src/lib/site.mjs` | Tool lists for menus and the footer; site name, URL, analytics ID, "More free tools" |
| `src/lib/render.mjs` | Build-time helpers that run the engine for samples and examples |
| `src/lib/analytics.ts` | `track()` and the size and time buckets |
| `src/components/Converter.astro`, `src/scripts/converter.ts` | The converter tool (markup and browser code) |
| `src/scripts/runner.ts`, `src/scripts/convert.worker.ts` | Runs a conversion on the main thread, or in a Web Worker above about 200 KB |
| `src/scripts/ui.ts` | Code panes with line numbers, files, drag and drop, downloads, clipboard, live region |
| `src/scripts/json-editor.ts`, `text-editor.ts`, `xml-editor.ts`, `yaml-editor.ts`, `csv-viewer.ts` | Editors and viewer |
| `src/components/` | `Example` (input and engine output), `CodePane`, `CodeView`, `EditorShell`, `Faq` (with FAQPage JSON-LD), `ConsentDefaults`, `ConsentBanner` |
| `src/layouts/Layout.astro` | Head (canonical, Open Graph, Twitter, JSON-LD, fonts, consent, Google tag), menu, breadcrumbs, footer |
| `src/pages/` | `index`, `converters`, `[pair]` (the 18 conversion pages), editors, `csv-viewer`, `formats/`, `about`, `privacy`, `404`, `robots.txt.ts` |
| `src/styles/global.css`, `tool.css` | The look (light and dark) and the workbench panes |
| `public/` | `_headers`, `favicon.svg`, `og-image.png`, `llms.txt`, `samples/orders.xlsx` |
| `scripts/` | `check-build.mjs`, `llms.mjs`, `og-image.mjs`, `samples.mjs` |
| `tests/` | `node --test` suites: one per format, `infer`, `detect`, `pairs-engine`, `content`, `config`, `llms` |

## The conversion rules

- **Common value.** Every format is parsed into plain data (objects, arrays, strings, numbers, booleans, null),
  then written out. Pair helpers handle what does not map directly (XML records to rows, rows to XML elements,
  tables copied cell for cell between CSV, TSV and Excel).
- **Type detection (CSV, TSV, XML text).** A text becomes a number, `true`, `false` or `null` only if writing it
  back gives exactly the same text. So `42` and `-3.5` convert; `007`, `1.50`, `1e5`, `+44…`, `TRUE` and
  integers beyond 2^53 stay strings. It is an option, on by default.
- **CSV and TSV** (Papa Parse): RFC 4180 quoting, BOM removed (and reported), delimiter detected among
  `, ; tab |`, CRLF and LF, blank lines skipped. Duplicate or empty headers become `name_2`, `column_4` with a
  note; rows with too few or too many fields are reported (extra fields go to `field_5` …). An unclosed quote is
  an error pointing at the opening quote. Writing: CRLF by default (LF optional), optional BOM, delimiter choice;
  TSV fields with tabs or line breaks are quoted or cleaned (an option).
- **JSON to tables**: an array of objects; columns are the union of keys in first-seen order; nested objects
  become dot paths (`address.city`); arrays of plain values are joined (`; ` by default) or written as JSON;
  arrays of objects are JSON text; a single object is one row; an object whose only key holds an array of
  objects uses that array. The reverse can nest dot-path headers (an option).
- **JSON** (native `JSON.parse`): on failure a small RFC 8259 scanner finds the first error and explains it with
  line and column, the same in every browser. It also notes duplicate keys and integers beyond 2^53. Format and
  minify in the editor re-indent the text without parsing it, so no digit or duplicate key changes.
- **YAML** (`yaml`, YAML 1.2): `no`, `on`, `yes` stay strings; anchors, aliases and merge keys are resolved, with
  an alias limit against "billion laughs"; several documents become an array (or the first only); errors are
  rewritten in plain words with line and column. Writing quotes any string YAML 1.1 readers would misread
  (`yes`/`no`/`on`/`off`, dates, `1:20`), an option on by default.
- **XML** (fast-xml-parser 5): attributes under an `@` prefix (configurable), text under `#text`, repeated
  elements become arrays, entities decoded, comments and declaration dropped. A document that declares entities in
  a DOCTYPE is rejected before parsing (no entity expansion). The well-formedness check adds checks the
  library's validator misses: bare `&`, unquoted attribute values, several root elements. Writing escapes
  `& < > " '`, renames keys that are not XML names (and lists them), uses the single top key or `<root>` as the
  root and `<item>` for anonymous array entries (both options). XML to CSV finds the record element by grouping
  elements by path and taking the most frequent (elements with children first); it can be named by hand. A child
  that is a list in any record is made a list in all, so rows share columns.
- **TOML** (smol-toml, TOML 1.0.0): null and a top-level array give an error that says why and what to do, or
  (options) null keys are left out and the array is wrapped under `items`. Dates become ISO strings in their
  TOML form; integers beyond 2^53 are kept exactly (written as digits in JSON); `inf`/`nan` become strings.
- **Excel** (read-excel-file, write-excel-file): one sheet at a time (chosen in the options); dates as ISO 8601
  (rounded to the second); formulas give their cached value; numbers to 15 significant digits; empty rows
  skipped; `.xls` and non-ZIP files get clear errors. Writing: header row bold and frozen, column widths set,
  text stays text (leading zeros kept), numbers longer than 15 digits are written as text. Styles, formulas,
  merged cells, comments and charts are not kept, and the pages say so.

## Libraries and why

All pinned to exact versions. `npm audit --omit=dev` reports 0 vulnerabilities.

| Library | Version | Why |
| --- | --- | --- |
| astro | 7.4.11 | Static site generator. Astro 5 (the house pattern) has critical and high advisories with no fix in 5.x; 7.4.7 and later are clean |
| @astrojs/sitemap | 3.7.4 | Sitemap (emits no-slash URLs; a `serialize` hook guarantees it) |
| papaparse | 5.7.0 | CSV/TSV, RFC 4180, delimiter detection, fast on 10 MB |
| yaml | 2.9.1 | YAML 1.2, positions on errors, comment-preserving format, alias limits |
| fast-xml-parser | 5.12.0 | XML; 5.11.2 and earlier have an advisory |
| smol-toml | 1.9.1 | TOML 1.0.0, small, positions on errors, BigInt for 64-bit integers |
| read-excel-file + write-excel-file | 9.3.13, 4.1.1 | Excel. Chosen over exceljs 4.4.0: exceljs is about 258 KB gzipped in the browser and pulls in `uuid` with a moderate advisory, and its last release is from 2023. These two are actively maintained, have no advisories, share `fflate`, run in browser and Node, and together add about 32 KB gzipped, loaded only when a workbook is read or written. The npm `xlsx` package is not used |
| ajv | 8.20.0 | JSON Schema drafts 07 and 2020-12, loaded only when a schema is used |

## Local development

Requires Node 22.23.4 or later (`.nvmrc`; Astro 7 needs it).

```sh
npm ci
npm run dev        # http://localhost:4321
npm test           # engine, content and config tests (node --test)
npm run build      # writes dist/
npm run check      # checks dist/: titles, descriptions, canonicals, H1s, JSON-LD, links, no trailing slashes,
                   # legacy URLs, samples rendered, sitemap = indexable pages, page similarity, no ads
npm run preview    # serves dist/
npm run llms       # rewrites public/llms.txt from the built pages (then build again)
npm run og-image   # re-renders public/og-image.png (1200×630) with an installed Playwright
npm run samples    # rewrites public/samples/orders.xlsx
```

After changing a title or description, or adding a page: `npm run build && npm run llms && npm run build`.
`tests/llms.test.mjs` fails if a page is missing from `llms.txt`. `tests/content.test.mjs` fails if two
conversion pages share more than 30% of their sentences (`npm run check` repeats this on the built HTML).

## Fonts

IBM Plex Sans and IBM Plex Mono from Google Fonts (`display=swap`). `global.css` defines local fallbacks with
`size-adjust` (Plex width divided by the local font's, measured in Chromium on this site's text: 99.8% for 400,
96.6% for 600 against Arial/Liberation Sans; monospace fonts are all 0.6 em wide) and ascent/descent overrides
that give the fallbacks Plex's vertical metrics (1.025 em and 0.275 em). The mobile menu is a fixed grid and the
format comparison table has fixed column widths, so the swap cannot re-wrap them. If a font or weight changes,
measure again.

## Deploy (Cloudflare Workers static assets)

1. Workers & Pages → Create → Import a repository → this repository.
2. Build command `npm run build`, deploy command `npx wrangler deploy`. `wrangler.jsonc` (worker
   `convert-data-formats`) serves `./dist` with `drop-trailing-slash` and `404.html` for missing pages.
3. Add the custom domain **convertdataformats.com** to the Worker, replacing the old Lovable deployment.
4. Turn on **SSL/TLS → Edge Certificates → Always Use HTTPS** for the zone.
5. Submit `https://convertdataformats.com/sitemap-index.xml` in Google Search Console (the old sitemap was
   `/sitemap.xml`; remove it there).

`public/_headers` sends HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options` and a restrictive
`Permissions-Policy`, and caches `/_astro/*` as immutable.

## Analytics

Google Analytics 4 with the old site's ID `G-YT5KVGERYC` (`src/lib/site.mjs`), behind the same Consent Mode
defaults and banner as the sister sites: ad storage denied for everyone; analytics storage denied by default in
the EEA, UK and Switzerland until Accept. Events (`track()`, no-op without the tag). None carries the data.

| Event | When | Parameters |
| --- | --- | --- |
| `conversion_done` | A conversion finishes after a sample, file, option or format change; typing counts at most every 30 s | `pair`, `size_bucket`, `ms_bucket` |
| `file_open` | A file is opened or dropped | `format` (extension), `tool` |
| `sample_load` | A sample button | `tool`, `sample` |
| `copy_output` | Copy | `pair` (or editor) |
| `download_output` | Download | `pair` (or editor), `format` |
| `conversion_error` | A conversion or validation fails (editors: at most every 30 s) | `pair`, `error_kind` |

## For the owner

- Check the Google Analytics property still receives data after launch (Realtime report).
- The old site saved the JSON editor's text under the local storage key `dfs-json-content`; the new editor uses
  the same key, so that text reappears. The privacy page lists every key.
- The live site and most outside hosts could not be reached while building this. Check after deploy: the
  redirect from `/json-editor/` to `/json-editor`, HTTPS redirects, and the Google tag.
- No contact address is published; add one to the About page if wanted.
