export default {
  slug: 'csv-to-tsv',
  title: 'CSV to TSV Converter: Comma-Separated to Tab-Separated',
  description: 'Convert CSV to tab-separated TSV in your browser. Quoted fields are unwrapped; fields with tabs or line breaks are quoted or cleaned, as you choose.',
  h1: 'CSV to TSV Converter',
  lede: 'Paste CSV or open a .csv file and get tab-separated text that pastes cleanly into a spreadsheet or loads into tools that expect TSV.',
  blurb: 'Unwraps CSV quoting; tabs and line breaks inside fields are quoted or replaced.',
  samples: [
    { label: 'Addresses', text: 'name,street,city,notes\n"Smith, Ann","12 High St, Apt 4",Boston,"Ring twice"\nBruno Díaz,Calle Mayor 5,Madrid,"Line one\nLine two"\n' },
    { label: 'Semicolons', text: 'Produkt;Preis;Lager\nKaffee;4,50;ja\nTee;3,20;nein\n' },
  ],
  rulesIntro: 'In TSV, commas are ordinary characters, so most CSV quoting disappears. The rules below cover what still needs care.',
  rules: [
    ['A comma between fields', 'A tab'],
    ['A quoted CSV field ("Smith, Ann")', 'The plain value: Smith, Ann'],
    ['A doubled quote inside a quoted field ("")', 'One quote, quoted again only if the TSV field needs it'],
    ['A field with a line break or a tab', 'Quoted, or the break replaced by a space (an option)'],
    ['Values', 'Copied character for character'],
    ['A header row', 'Copied as the first line'],
  ],
  example: {
    input: 'id,title,tags\n1,"Lamp, desk","office,lighting"\n2,Bulb,\n',
    text: 'The quotes around "Lamp, desk" and "office,lighting" are no longer needed, because their commas do not separate anything in TSV.',
  },
  optionDocs: [
    { option: 'delimiter', text: 'Detect finds commas, semicolons, tabs and pipes. Choose the delimiter yourself for a one-column file, or if detection picks the wrong one.', input: 'Produkt;Preis\nKaffee;4,50\n', variants: [['Detect', {}], ['Comma (wrong here)', { delimiter: 'comma' }]] },
    { option: 'tsvMode', text: 'Strict TSV cannot hold a tab or a line break inside a field. "Quote the field" wraps such fields in double quotes as CSV does; spreadsheet programs and Papa Parse read that. "Replace with a space" removes them, which suits simple tools that split lines on tabs.', input: 'id,note\n1,"First line\nsecond line"\n', variants: [['Quote the field', {}], ['Replace with a space', { tsvMode: 'replace' }]] },
    { option: 'lineEnding', text: 'CRLF for Windows programs, LF for Unix tools such as cut, awk and sort.', input: 'a,b\n1,2\n', variants: [['CRLF', {}], ['LF', { lineEnding: 'lf' }]] },
  ],
  errors: [
    { input: 'id,quote\n1,"He said ""stop"" and\n2,left\n', text: 'The quoted field never closes: each "" stands for one quote character, so a closing quote is still missing. Add a quote after "and".' },
    { input: 'id,name\n1,Ann,extra\n', text: 'This row has an extra field. In the CSV source, a value that contains a comma must be put in double quotes.' },
  ],
  watch: [
    'Tabs inside values cannot be kept as they are in TSV. With quoting on, readers that do not understand quotes will split such fields; with replacing, the tab becomes a space.',
    'Line breaks inside values have the same problem: quoted, or replaced by spaces.',
    'Values are not converted or trimmed: 4,50 stays 4,50, and leading spaces stay.',
  ],
  faq: [
    ['How do I convert CSV to TSV?', 'Paste the CSV or open the file. The tab-separated text appears on the right; copy it or download a .tsv file.'],
    ['Why convert CSV to TSV?', 'TSV needs almost no quoting, because data rarely contains tabs. It pastes straight into spreadsheet cells and is easy to process with command-line tools.'],
    ['What happens to commas inside values?', 'Nothing: in TSV a comma is an ordinary character, so the value is written as it is, without quotes.'],
    ['What if a value contains a tab?', 'By default the field is wrapped in double quotes. Choose "Replace with a space" if the program reading the TSV does not understand quotes.'],
    ['Does it read semicolon CSV files?', 'Yes. The delimiter is detected among comma, semicolon, tab and pipe.'],
    ['Is the file uploaded?', 'No. It is converted in your browser.'],
  ],
  related: ['csv-to-json', 'csv-to-excel', 'json-to-csv'],
};
