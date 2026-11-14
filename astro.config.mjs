import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/lib/site.mjs';

// The old site's addresses (/json-editor, /xml-editor, /yaml-editor, /converters) had no trailing slash and
// keep that exact spelling: pages are built as files (json-editor.html) and every link drops the slash.
export default defineConfig({
  site: site.url,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    sitemap({
      filter: page => !/\/404(?:\.html)?$/.test(page),
      // The sitemap must list the same no-slash URLs the pages use as canonical.
      serialize: item => ({ ...item, url: item.url.length > site.url.length + 1 ? item.url.replace(/\/$/, '') : item.url }),
    }),
  ],
  vite: {
    worker: { format: 'es' },
    server: { allowedHosts: ['terminal.local'] },
  },
});
