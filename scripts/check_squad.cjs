const fs = require('fs');
const db = JSON.parse(fs.readFileSync('local_db.json', 'utf8'));
const smPhones = new Set(Object.keys(db.squad_members || {}));
const sa = Object.values(db.squad_applications || {});

const approvedInSa = sa.filter(a => {
  const p = a.id || a.phone;
  return a.status === '已通过' || a.status === 'approved' || a.status === '通过';
});

console.log('Total approved in squad_applications:', approvedInSa.length);
const notInSm = approvedInSa.filter(a => !smPhones.has(a.id || a.phone));
console.log('Approved applications NOT in squad_members (count: ' + notInSm.length + '):', notInSm.map(a => (a.id || a.phone) + ' ' + (a.name || a.driverName)));
