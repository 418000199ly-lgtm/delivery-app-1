const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'local_db.json');
let dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

if (!dbData.driver_users) dbData.driver_users = {};
if (!dbData.squad_members) dbData.squad_members = {};
if (!dbData.squad_applications) dbData.squad_applications = {};
if (!dbData.online_applications) dbData.online_applications = {};

const userList = [
  { name: '马斌', phone: '18995480270' },
  { name: '包蕾', phone: '13519585040' },
  { name: '王永刚', phone: '19289570583' },
  { name: '王飞虎', phone: '15595590533' },
  { name: '刘恒涛', phone: '18209605989' },
  { name: '赵岩', phone: '18169102771' },
  { name: '赵让', phone: '15595577097' },
  { name: '林俊杰', phone: '18695119126' },
  { name: '陶小鹏', phone: '15809668935' },
  { name: '吴自波', phone: '18395291285' },
  { name: '徐博', phone: '19529517310' },
  { name: '李鑫', phone: '13099566633' },
  { name: '王张鑫宇', phone: '19395518058' },
  { name: '赵楠', phone: '18809588001' },
  { name: '白耀宗', phone: '19995429551' },
  { name: '徐士均', phone: '13709509055' },
  { name: '童兵', phone: '18695174428' },
  { name: '陈永', phone: '16609514530' },
  { name: '娄渊东', phone: '15809602681' },
  { name: '张栋', phone: '19995179865' },
  { name: '陆学东', phone: '13895001657' },
  { name: '刘家林', phone: '17752417100' },
  { name: '杨怀治', phone: '13895664414' },
  { name: '赵伟', phone: '18209506667' },
  { name: '朱东', phone: '18795077159' },
  { name: '田二杰', phone: '17795034781' },
  { name: '滴杨明7350', phone: '19995387350' },
  { name: '张瑞', phone: '15121886521' },
  { name: '纳琳7975', phone: '19995377975' },
  { name: '宋伟', phone: '13995213747' },
  { name: '杨涛', phone: '13259619432' },
  { name: '李金锋', phone: '15296915876' },
  { name: '武红永', phone: '13209694845' },
  { name: '杨刚', phone: '15226203822' },
  { name: '张武保', phone: '18309616829' },
  { name: '许占宁', phone: '18100951075' },
  { name: '赵磊', phone: '13209586682' },
  { name: '刘福', phone: '18909599208' },
  { name: '姚志虎', phone: '18975508484' },
  { name: '王银生', phone: '13619581400' },
  { name: '赵让', phone: '18295567696' },
  { name: '魏秉金', phone: '17866167770' },
  { name: '周杰伦', phone: '15121904440' },
  { name: '王龙龙', phone: '13895336277' },
  { name: '张缠红', phone: '13239598341' },
  { name: '朱萍', phone: '15379500777' },
  { name: '王平', phone: '18695161718' },
  { name: '陈小飞', phone: '19995446924' },
  { name: '尚哥尚伟', phone: '13139502215' },
  { name: '杨飞', phone: '18169099625' },
  { name: '马振杰', phone: '15769697890' },
  { name: '尹柏学', phone: '18795109699' },
  { name: '冷文亮', phone: '13564766297' },
  { name: '王林', phone: '14709589555' },
  { name: '王瑞丁', phone: '17795096007' },
  { name: '冯晓龙', phone: '18209679070' },
  { name: '张彦军', phone: '18909562655' },
  { name: '赵文举', phone: '13995144333' },
  { name: '许昊', phone: '16695188333' },
  { name: '邓涛', phone: '18161635231' },
  { name: '罗玉吉', phone: '15899116203' },
  { name: '李海鹏', phone: '18309593933' },
  { name: '王东财', phone: '13209506973' },
  { name: '袁军', phone: '18095430908' },
  { name: '夏文昊', phone: '18169013501' },
  { name: '何威', phone: '18893028866' },
  { name: '杨海', phone: '18095513030' },
  { name: '于涛', phone: '13995374330' },
  { name: '袁鹏辉', phone: '15909516561' },
  { name: '马玉娟', phone: '13895684560' },
  { name: '赵阳', phone: '18395073235' },
  { name: '王文杰', phone: '15378989691' },
  { name: '马学斌', phone: '18595190708' },
  { name: '夏伟1030', phone: '13895081030' },
  { name: '拓万东', phone: '18161583039' },
  { name: '田殿铖', phone: '18695101995' },
  { name: '赵晓耀', phone: '17744638111' },
  { name: '祁宏伟', phone: '18295211121' },
  { name: '杨莉锋', phone: '18109582237' },
  { name: '王军军', phone: '17811114353' },
  { name: '徐亮', phone: '15378994587' },
  { name: '王贤亮', phone: '14709696333' },
  { name: '禹全江', phone: '15209678783' },
  { name: '王灵', phone: '15378921387' },
  { name: '赵文举', phone: '13995071199' },
  { name: '于涛', phone: '13995388888' },
  { name: '张瑞', phone: '15121888888' },
  { name: '李金锋', phone: '15295188888' },
  { name: '杨存安', phone: '15296972638' },
  { name: '丁向东', phone: '17711811457' }
];

// Developer master profile
dbData.driver_users['15509601222'] = {
  phone: '15509601222',
  phoneNumber: '15509601222',
  name: '吴彦祖',
  driverName: '吴彦祖',
  role: '开发者司机',
  userRole: '开发者司机',
  squad_position: 'developer',
  is_squad_member: 1,
  status: '已通过',
  vipExpiry: '永久有效',
  city: '银川市',
  isOnline: false,
  isBusy: false,
  today_orders_count: 0,
  qrcode_url: '/uploads/qrcodes/15509601222.png',
  approvedBy: '最高开发者',
  approvedRole: '开发者司机',
  updatedAt: new Date().toISOString()
};

dbData.squad_members['15509601222'] = {
  id: '15509601222',
  phone: '15509601222',
  phoneNumber: '15509601222',
  name: '吴彦祖',
  driverName: '吴彦祖',
  role: '开发者司机',
  userRole: '开发者司机',
  squad_position: 'developer',
  is_squad_member: 1,
  status: '已通过',
  vipExpiry: '永久有效',
  city: '银川市',
  isOnline: false,
  isBusy: false,
  today_orders_count: 0,
  qrcode_url: '/uploads/qrcodes/15509601222.png',
  approvedBy: '最高开发者',
  approvedRole: '开发者司机',
  updatedAt: new Date().toISOString()
};

// Now sync all 90 drivers
for (const u of userList) {
  const p = u.phone;
  const existingDu = dbData.driver_users[p] || {};
  const existingSq = dbData.squad_members[p] || {};
  
  // Expiry: prioritize existingDu.vipExpiry or server-stored expiry
  let vipExp = '2026-11-19';
  if (existingDu.vipExpiry && existingDu.vipExpiry !== '待开通') {
    vipExp = existingDu.vipExpiry;
  } else if (p === '15121904440') {
    vipExp = '2026-10-20'; // 20 days matching server
  }

  let role = (p === '15509601222') ? '开发者司机' : (existingDu.role || existingSq.role || '普通司机');
  let pos = (role === '城市派单员司机') ? 'dispatcher' : (role === '城市管理司机') ? 'manager' : (role === '城市老板司机') ? 'city_boss' : (role === '开发者司机') ? 'developer' : 'normal';

  const profile = {
    phone: p,
    phoneNumber: p,
    id: p,
    name: u.name,
    driverName: u.name,
    applicantName: u.name,
    realName: u.name,
    role: role,
    userRole: role,
    position: role,
    squad_position: pos,
    is_squad_member: 1,
    status: '已通过',
    vipExpiry: vipExp,
    city: existingDu.city || existingSq.city || '银川市',
    isOnline: Boolean(existingDu.isOnline || existingSq.isOnline),
    isBusy: Boolean(existingDu.isBusy || existingSq.isBusy),
    onlineOrdersEnabled: true,
    today_orders_count: existingDu.today_orders_count || 0,
    qrcode_url: '/uploads/qrcodes/' + p + '.png',
    approvedBy: '吴彦祖',
    approvedRole: '开发者司机',
    approvalTime: '2026-09-30T00:00:00.000Z',
    updatedAt: new Date().toISOString()
  };

  dbData.driver_users[p] = { ...existingDu, ...profile };
  dbData.squad_members[p] = { ...existingSq, ...profile };
  dbData.online_applications[p] = { ...(dbData.online_applications[p] || {}), ...profile };
  dbData.squad_applications[p] = { ...(dbData.squad_applications[p] || {}), ...profile };
}

// Ensure rejected applicants are in online_applications and squad_applications
const rejectedList = [
  { phone: '18095193399', name: '司机3399', reason: '资料不全' },
  { phone: '17377746647', name: '司机6647', reason: '审核未通过' }
];

for (const r of rejectedList) {
  const rejProfile = {
    phone: r.phone,
    phoneNumber: r.phone,
    id: r.phone,
    name: r.name,
    driverName: r.name,
    role: '代驾司机',
    userRole: '代驾司机',
    is_squad_member: 0,
    status: '已拒绝',
    vipExpiry: '待开通',
    rejectReason: r.reason,
    updatedAt: new Date().toISOString()
  };
  delete dbData.squad_members[r.phone];
  dbData.driver_users[r.phone] = { ...(dbData.driver_users[r.phone] || {}), ...rejProfile };
  dbData.online_applications[r.phone] = rejProfile;
  dbData.squad_applications[r.phone] = rejProfile;
}

fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
console.log('Database synced successfully!');
console.log('squad_members count:', Object.keys(dbData.squad_members).length);
console.log('driver_users count:', Object.keys(dbData.driver_users).length);
