const fs = require('fs');
const nr = fs.readFileSync('src/utils/nameResolver.ts', 'utf8');

function isGenericDriverName(name, phone) {
  if (!name) return true;
  const str = String(name).trim();
  if (['司机', '代驾司机', '在线代驾司机', '注册司机', '普通司机', '快车司机'].includes(str)) return true;
  if (/^司机\d{3,6}$/.test(str)) return true;
  if (/^代驾\d{3,6}$/.test(str)) return true;
  if (phone) {
    const cleanP = String(phone).replace(/\D/g, '');
    const last4 = cleanP.slice(-4);
    if (last4 && (str === `司机${last4}` || str === `代驾${last4}`)) return true;
  }
  return false;
}

const list = [
  { phone: '13895081030', name: '夏伟1030' },
  { phone: '19995377975', name: '纳琳7975' },
  { phone: '19995387350', name: '滴杨明7350' },
  { phone: '15509601222', name: '吴彦祖' },
  { phone: '15121904440', name: '周杰伦' },
];

list.forEach(item => {
  console.log(item.phone, item.name, 'isGeneric:', isGenericDriverName(item.name, item.phone));
});
