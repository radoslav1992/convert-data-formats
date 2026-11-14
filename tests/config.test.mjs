import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { site, moreTools } from '../src/lib/site.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('site settings: name, URL and the Google Analytics ID kept from the old site', () => {
  assert.equal(site.name, 'Convert Data Formats');
  assert.equal(site.url, 'https://convertdataformats.com');
  assert.equal(site.analyticsId, 'G-YT5KVGERYC');
  assert.ok(site.defaultTitle.length <= 60);
  assert.ok(site.defaultDescription.length >= 120 && site.defaultDescription.length <= 155, `description is ${site.defaultDescription.length}`);
});

test('the HEIC Converter link is kept under "More free tools"', () => {
  assert.deepEqual(moreTools.map(t => t.url), ['https://heicconverter.net']);
  assert.equal(`${moreTools[0].name}: ${moreTools[0].about}`, 'HEIC Converter: convert HEIC photos to JPG, PNG or WEBP in your browser');
  assert.match(read('src/layouts/Layout.astro'), /More free tools/);
});

test('URLs have no trailing slash: Astro config and Cloudflare settings', () => {
  const config = read('astro.config.mjs');
  assert.match(config, /trailingSlash: 'never'/);
  assert.match(config, /format: 'file'/);
  const wrangler = JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(wrangler.name, 'convert-data-formats');
  assert.equal(wrangler.assets.html_handling, 'drop-trailing-slash');
  assert.equal(wrangler.assets.not_found_handling, '404-page');
  assert.equal(wrangler.assets.directory, './dist');
});

test('security headers and caching', () => {
  const headers = read('public/_headers');
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /\/_astro\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
});

test('no ads and no links to the education labs', () => {
  const files = fs.readdirSync(new URL('../src', import.meta.url), { recursive: true }).filter(f => /\.(astro|mjs|ts|css)$/.test(f));
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/adsbygoogle|googlesyndication|AdSlot|ad-slot/.test(source), `${file}: ad code`);
    assert.ok(!/fictionandfactlibrary|interactiveperiodictable|learning-apps/.test(source), `${file}: links to the education labs`);
  }
});

test('dependencies are pinned to exact versions, and the old xlsx package is not used', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version} is pinned`);
  assert.ok(!('xlsx' in pkg.dependencies), 'the npm xlsx package has known advisories');
  for (const lib of ['papaparse', 'yaml', 'fast-xml-parser', 'smol-toml', 'read-excel-file', 'write-excel-file', 'ajv']) assert.ok(pkg.dependencies[lib], lib);
});

test('Excel libraries are only loaded on demand', () => {
  for (const file of ['src/scripts/converter.ts', 'src/scripts/ui.ts', 'src/scripts/runner.ts', 'src/lib/convert/index.mjs']) {
    assert.ok(!/from ['"](read|write)-excel-file|from ['"]\.\/xlsx\.mjs/.test(read(file)), `${file} imports an Excel library statically`);
  }
});
