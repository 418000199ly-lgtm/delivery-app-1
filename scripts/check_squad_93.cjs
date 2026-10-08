const fs = require('fs');
const db = JSON.parse(fs.readFileSync('local_db.json', 'utf8'));

const NON_SQUAD_PHONES = [
  "19995426058", "15509601223", "13895299147", "17660453634", "13812345678",
  "13912345678", "18195005671", "18695103399", "18695106647", "18095193399",
  "17377746647", "14709503822", "13895000116", "13995101958", "13895001223",
  "13995206058", "13709501111", "13809502222", "13909503333", "15009504444",
  "15109505555", "15209506666", "15309507777", "15509508888", "15609509999",
  "15709501234", "15809502345", "15909503456", "17709504567", "17809505678"
];

const allDu = Object.values(db.driver_users || {});
console.log('Total driver_users:', allDu.length);

const nonSquad = allDu.filter(d => NON_SQUAD_PHONES.includes(d.id || d.phone));
console.log('Non-squad drivers count in db:', nonSquad.length);

const squadDrivers = allDu.filter(d => !NON_SQUAD_PHONES.includes(d.id || d.phone) && !(d.id || d.phone).endsWith('A'));
console.log('Squad drivers in driver_users count:', squadDrivers.length);
squadDrivers.forEach((d, idx) => {
  console.log(`${idx + 1}. ${d.id || d.phone} ${d.driverName || d.name} role:${d.role || 'default'}`);
});
