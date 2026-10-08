const fs = require('fs');
const nr = fs.readFileSync('src/utils/nameResolver.ts', 'utf8');
const regex = /'(\d{11})':\s*'([^']+)'/g;
let match;
let count = 0;
const phones = [];
while ((match = regex.exec(nr)) !== null) {
  count++;
  phones.push(match[1]);
}
console.log('Total entries in AUTHORITATIVE_REAL_DRIVER_NAMES:', count);
console.log('Unique phones:', new Set(phones).size);

// Check if any duplicate keys in AUTHORITATIVE_REAL_DRIVER_NAMES
const counts = {};
phones.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
const dupes = Object.keys(counts).filter(p => counts[p] > 1);
console.log('Duplicates in AUTHORITATIVE_REAL_DRIVER_NAMES:', dupes);
