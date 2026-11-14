// Writes the sample workbook used by the Excel converters (public/samples/orders.xlsx): `npm run samples`.
// Two sheets, with text that keeps leading zeros, numbers, booleans, a date column and an empty cell.
import fs from 'node:fs';
import writeXlsxFile from 'write-excel-file/universal';

const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));
const orders = [
  ['order_id', 'customer', 'country', 'postcode', 'ordered_on', 'items', 'total', 'paid'],
  ['A-1001', 'Ann Smith', 'US', '02134', d(2024, 3, 15), 2, 129.99, true],
  ['A-1002', 'Bruno Díaz', 'ES', '28013', d(2024, 3, 16), 1, 54.5, false],
  ['A-1003', 'Chen Wei', 'SG', '018956', d(2024, 3, 18), 5, 1200, true],
  ['A-1004', 'Zoë Martin', 'FR', '75011', d(2024, 3, 19), 3, 86.25, null],
];
const customers = [
  ['customer', 'email', 'since'],
  ['Ann Smith', 'ann@example.com', d(2021, 6, 1)],
  ['Bruno Díaz', 'bruno@example.es', d(2023, 2, 14)],
];
const header = row => row.map(value => ({ value, fontWeight: 'bold' }));
const sheet = (rows, name) => ({ sheet: name, data: [header(rows[0]), ...rows.slice(1).map(r => r.map(v => (v instanceof Date ? { value: v, type: Date, format: 'yyyy-mm-dd' } : v)))], columns: rows[0].map(() => ({ width: 14 })) });
const blob = await writeXlsxFile([sheet(orders, 'Orders'), sheet(customers, 'Customers')]).toBlob();
fs.writeFileSync(new URL('../public/samples/orders.xlsx', import.meta.url), Buffer.from(await blob.arrayBuffer()));
console.log('Wrote public/samples/orders.xlsx');
