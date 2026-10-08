const fs = require('fs');
const db = JSON.parse(fs.readFileSync('local_db.json', 'utf8'));

// Check all keys in squad_applications
const sa = Object.keys(db.squad_applications || {});
const du = Object.keys(db.driver_users || {});
const sm = Object.keys(db.squad_members || {});

console.log('du count:', du.length);
console.log('sm count:', sm.length);
console.log('sa count:', sa.length);

const saOnly = sa.filter(p => !sm.includes(p));
console.log('Phones in sa but not in sm (count: ' + saOnly.length + '):', saOnly);
saOnly.forEach(p => {
  const item = db.squad_applications[p];
  console.log(p, item.name || item.driverName, item.status);
});
