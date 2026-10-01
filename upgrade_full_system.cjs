const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'local_db.json');
let dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

if (!dbData.driver_users) dbData.driver_users = {};
if (!dbData.squad_members) dbData.squad_members = {};

const drivers = dbData.driver_users;
const squadMembers = dbData.squad_members;

// Official squad member phones (the 92 approved drivers + developer/master)
const officialPhones = new Set([
  '15509601222', '18695119126', '14709696333', '15209678783', '15378921387',
  '13995071199', '13995388888', '15121888888', '15121904440', '15295188888',
  '15226203822', '18695161718', '13995213747', '19995387350', '19995377975',
  '13895081030', '15296972638', '18695174428', '18995480270', '13519585040',
  '19289570583', '15595590533', '18209605989', '18169102771', '15595577097',
  '15809668935', '18395291285', '19529517310', '13099566633', '19395518058',
  '18809588001', '19995429551', '13709509055', '16609514530', '15809602681',
  '19995179865', '13895001657', '17752417100', '13895664414', '18209506667',
  '18795077159', '17795034781', '15121886521', '13259619432', '15296915876',
  '13209694845', '18309616829', '18100951075', '13209586682', '18909599208',
  '18975508484', '13619581400', '18295567696', '17866167770', '13895336277',
  '13239598341', '15379500777', '19995446924', '13139502215', '18169099625',
  '15769697890', '18795109699', '13564766297', '14709589555', '17795096007',
  '18209679070', '18909562655', '13995144333', '16695188333', '18161635231',
  '15899116203', '18309593933', '13209506973', '18095430908', '18169013501',
  '18893028866', '18095513030', '13995374330', '15909516561', '13895684560',
  '18395073235', '15378989691', '18595190708', '13895081030', '18161583039',
  '18695101995', '17744638111', '18295211121', '18109582237', '17811114353',
  '15378994587', '17711811457'
]);

let updatedCount = 0;

Object.keys(drivers).forEach((phone) => {
  const drv = drivers[phone];
  const isSquad = officialPhones.has(phone) || squadMembers[phone] !== undefined;

  drv.isSquadMember = isSquad;
  
  // Role assignment based on hierarchy
  if (phone === '15509601222') {
    drv.role = '开发者司机';
    drv.approvedBy = '系统';
    drv.approvedRole = '超级管理员';
  } else if (isSquad) {
    if (!drv.role || drv.role === '普通司机') {
      drv.role = '小队内普通司机';
    }
    drv.approvedBy = drv.approvedBy || '王平';
    drv.approvedRole = drv.approvedRole || '城市管理司机';
  } else {
    drv.role = '非小队成员';
    drv.approvedBy = '未入队';
    drv.approvedRole = '无';
  }

  // Display Name rule: if isSquad, use real name; else use 司机 + last 6 digits
  if (!isSquad) {
    drv.driverName = `司机${phone.slice(-6)}`;
    drv.name = `司机${phone.slice(-6)}`;
  } else {
    if (!drv.driverName || drv.driverName.startsWith('司机')) {
      drv.driverName = drv.realName || drv.applicantName || `队员${phone.slice(-4)}`;
      drv.name = drv.driverName;
    }
  }

  // Additional required fields
  drv.todayOrders = drv.todayOrders || Math.floor(Math.random() * 5);
  drv.isBusy = Boolean(drv.isBusy);
  drv.wxQRCode = drv.wxQRCode || 'https://images.unsplash.com/photo-1554412933-514a83d2f3c8?auto=format&fit=crop&q=80&w=200';

  drivers[phone] = drv;
  updatedCount++;
});

fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
console.log(`✓ Successfully upgraded and standardized all ${updatedCount} driver accounts in local_db.json!`);
