// Site-wide settings. Canonical links, the sitemap, robots.txt, llms.txt and Open Graph tags all use `url`.
export const site = {
  name: 'Convert Data Formats',
  url: 'https://convertdataformats.com',
  tagline: 'Convert, view, format and validate CSV, JSON, YAML, XML, TOML and Excel files in your browser.',
  // Google Analytics 4 measurement ID, kept from the previous site so the history continues. While empty, no
  // Google tag is rendered and the cookie banner stays hidden.
  analyticsId: 'G-YT5KVGERYC',
  defaultTitle: 'Convert Data Formats: CSV, JSON, YAML, XML & Excel Converter',
  defaultDescription: 'Free converters, editors and validators for CSV, TSV, JSON, YAML, XML, TOML and Excel. Everything runs in your browser; files are never uploaded.',
};

// Other free tools from the same owner, shown in the footer under "More free tools".
export const moreTools = [
  { name: 'HEIC Converter', url: 'https://heicconverter.net', about: 'convert HEIC photos to JPG, PNG or WEBP in your browser' },
];
