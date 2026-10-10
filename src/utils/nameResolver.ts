import { db, collection, getDocs, doc, setDoc } from '../lib/dbProxy';
import { getBaseApiUrl } from '../lib/dbProxy';

/**
 * Common 2-character Chinese compound surnames (复姓)
 */
const COMPOUND_SURNAMES = [
  '欧阳', '诸葛', '司马', '上官', '夏侯', '东方', '独孤', '南宫', '皇甫', '司徒', '尉迟', '公孙', '慕容', '宇文'
];

/**
 * Authoritative mapping of genuine squad drivers to prevent fallbacks like "司机6333" on any device
 */
export const AUTHORITATIVE_REAL_DRIVER_NAMES: Record<string, string> = {
  '15509601222': '吴彦祖'
};

/**
 * Official Squad Role Hierarchy & Permissions
 * 等级划分：开发者司机 (5) > 城市老板司机 (4) > 城市管理司机 (3) > 城市派单员司机 (2) > 普通司机 (1)
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  '开发者司机': 5,
  '开发者': 5,
  '最高开发者': 5,
  '总指挥官': 5,
  '城市老板司机': 4,
  '城市老板': 4,
  '城市管理司机': 3,
  '城市管理': 3,
  '管理司机': 3,
  '城市派单员司机': 2,
  '城市派单员': 2,
  '派单员司机': 2,
  '普通司机': 1,
  '司机': 1,
  '队员': 1
};

export function getRoleLevel(role: string): number {
  const trimmed = String(role || '').trim();
  return ROLE_HIERARCHY[trimmed] || 1;
}

export function isSquadManager(role: string, phone?: string): boolean {
  if (phone === '15509601222') return true;
  const level = getRoleLevel(role);
  return level >= 2; // Level 2 (城市派单员司机) and above are management
}

export function getAllowedAssignableRoles(operatorRole: string, operatorPhone: string | undefined, targetMember: any): string[] {
  if (!targetMember) return [];
  const targetPhone = String(targetMember.phone || targetMember.id || '').replace(/\D/g, '').trim();
  if (targetPhone === '15509601222') return []; // 任何人都不能修改开发者司机的角色

  const isDevOp = operatorPhone === '15509601222' || operatorRole === '开发者司机' || operatorRole === '开发者' || operatorRole === '最高开发者' || operatorRole === '总指挥官';
  if (isDevOp) {
    // 开发者司机可以设置城市老板司机、城市管理司机、城市派单员司机、普通司机
    return ['城市老板司机', '城市管理司机', '城市派单员司机', '普通司机'];
  }

  const opLevel = getRoleLevel(operatorRole);
  const targetRole = String(targetMember.role || targetMember.userRole || '普通司机').trim();
  const targetLevel = getRoleLevel(targetRole);

  // 同等级之间不能相互调整职位，低等级的不能越权调整高等级的职位
  if (opLevel <= targetLevel) return [];

  // 等级高的职位可以调整等级低的职位
  if (opLevel === 4) { // 城市老板司机
    return ['城市管理司机', '城市派单员司机', '普通司机'];
  }
  if (opLevel === 3) { // 城市管理司机
    return ['城市派单员司机', '普通司机'];
  }
  if (opLevel === 2) { // 城市派单员司机
    return ['普通司机'];
  }
  return [];
}

export function canDeleteTargetMember(operatorRole: string, operatorPhone: string | undefined, targetMember: any): boolean {
  if (!targetMember) return false;
  const targetPhone = String(targetMember.phone || targetMember.id || '').replace(/\D/g, '').trim();
  const cleanUserPhone = String(operatorPhone || '').replace(/\D/g, '').trim();

  // 1. 任何人都不能删除 15509601222
  if (targetPhone === '15509601222') return false;

  // 2. 不能删除自己
  if (cleanUserPhone && targetPhone && cleanUserPhone === targetPhone) return false;

  // 3. 开发者司机可以删除所有其他司机
  if (cleanUserPhone === '15509601222' || operatorRole === '开发者司机' || operatorRole === '开发者' || operatorRole === '最高开发者' || operatorRole === '总指挥官') {
    return true;
  }

  // 4. 等级高的职位可以删除等级低的职位，同等级之间不能相互删除，低等级不能越权删除高等级
  const opLevel = getRoleLevel(operatorRole);
  if (opLevel < 2) return false; // 只有管理人员才可以删除

  const targetRole = String(targetMember.role || targetMember.userRole || '普通司机').trim();
  const targetLevel = getRoleLevel(targetRole);

  return opLevel > targetLevel;
}

export function canClearListPermission(role: string, phone?: string): boolean {
  if (phone === '15509601222') return true;
  const level = getRoleLevel(role);
  // 开发者司机、城市老板司机、城市管理司机可以清空列表，城市派单员司机、普通司机隐藏
  return level >= 3;
}

/**
 * 硬编码黑名单已删除（2026-10-10）：用户要求取消号码限制，改由服务端"已删除司机"标记控制
 */

export function getRemovedSquadSet(): Set<string> {
  const set = new Set<string>();
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('dd_removed_squad_phones_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((p: any) => {
            const clean = String(p || '').replace(/\D/g, '').trim();
            if (clean) set.add(clean);
          });
        }
      }
    } catch (_) {}
  }
  return set;
}

/**
 * Universal authoritative helper to strictly determine whether a driver is an official squad member.
 * Shared across AdminPanel, HomeView, and DispatchValetOrder to ensure 100% synchronized member counts.
 */
export function isOfficialSquadMember(drv: any, removedSet?: Set<string>): boolean {
  if (!drv) return false;
  const rawP = String(drv.phoneNumber || drv.phone || drv.id || '').trim();
  const rawRole = String(drv.role || drv.userRole || '').trim();
  const rawType = String(drv.accountType || drv.type || '').trim();
  const rawName = String(drv.driverName || drv.name || drv.applicantName || drv.merchantName || '').trim();

  // 1. 优先严格防爆：剔除所有商户/商家账号 (以 'A' 结尾、accountType为merchant、或包含商户/商家角色/名称)
  if (
    rawP.toUpperCase().endsWith('A') ||
    rawType === 'merchant' ||
    drv.isMerchant === true ||
    ((rawRole.includes('商户') || rawRole.includes('商家') || rawName.includes('商户') || rawName.includes('商家')) && !rawRole.includes('司机'))
  ) {
    return false;
  }

  const p = rawP.replace(/\D/g, '').trim();
  if (!p || p.length < 11) return false;

  // 2. 15509601222 开发者司机常驻小队正式成员，拥有最高权限，永远为 true
  if (p === '15509601222') return true;

  const activeRemovedSet = removedSet || getRemovedSquadSet();
  if (activeRemovedSet.has(p)) {
    return false;
  }

  // 检查状态：只要明确不是通过状态，或包含拒绝/未加入/待审核/离职，一律判定为非正式成员
  const st = String(drv.status || '').trim();
  const appSt = String(drv.approvalStatus || '').trim();
  const effectiveStatus = st || appSt;

  if (!effectiveStatus || ['已拒绝', '已离职', '未加入小队', '待审核', 'pending', '审核中', 'rejected', '已解散'].includes(effectiveStatus)) {
    return false;
  }

  if (st && ['已拒绝', '已离职', '未加入小队', '待审核', 'pending', '审核中', 'rejected', '已解散'].includes(st)) {
    return false;
  }

  if (drv.is_squad_member === 0 || drv.inSquad === false || drv.isSquadMember === false) {
    return false;
  }

  if (rawRole === '非小队成员' || rawRole === '未加入小队' || rawRole === '商户、商家') {
    return false;
  }

  if (isGenericDriverName(rawName, p) && !AUTHORITATIVE_REAL_DRIVER_NAMES[p]) {
    return false;
  }

  // 必须是明确审核通过并属于小队的成员（通过 collection、is_squad_member、inSquad 等标志判定）
  const hasSquadFlag = Boolean(
    drv.collection === 'squad_members' ||
    drv.is_squad_member === 1 ||
    drv.inSquad === true ||
    drv.isSquadMember === true ||
    drv.isOfficial === true
  );

  if (hasSquadFlag && ['已通过', 'approved', '通过'].includes(effectiveStatus)) {
    return true;
  }

  return false;
}

// Global in-memory cache for customized driver names to ensure instantaneous, zero-latency reactive updates
const driverCustomNameRegistry = new Map<string, string>(Object.entries(AUTHORITATIVE_REAL_DRIVER_NAMES));

/**
 * Register a driver name into memory and localStorage cache
 */
export function registerDriverCustomName(phone: string, name: string): void {
  const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
  const finalName = String(name || '').trim().slice(0, 8);
  if (!cleanPhone || !finalName) return;
  if (finalName === '代驾司机' || finalName === '在线代驾司机' || finalName === '司机' || finalName === '未命名') return;
  if (finalName.includes('商户') || finalName.includes('商家')) return;
  driverCustomNameRegistry.set(cleanPhone, finalName);
  AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] = finalName;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`dd_driver_name_${cleanPhone}`, finalName);
    } catch (_) {}
  }
}

/**
 * Clear cached names for a driver when they are deleted or re-applying
 */
export function clearDriverCachedName(phone: string): void {
  const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
  if (!cleanPhone) return;
  driverCustomNameRegistry.delete(cleanPhone);
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(`dd_driver_name_${cleanPhone}`);
      localStorage.removeItem(`dd_admin_name_${cleanPhone}`);
      localStorage.removeItem(`dd_custom_app_name_${cleanPhone}`);
      localStorage.removeItem(`dd_applicant_name_${cleanPhone}`);
      localStorage.removeItem(`dd_user_name_${cleanPhone}`);
      localStorage.removeItem(`dd_squad_member_${cleanPhone}`);
    } catch (_) {}
  }
}

/**
 * Update a driver's custom name globally across all storage layers, memory registries, and event buses
 */
export async function updateDriverGlobalName(phone: string, newName: string): Promise<string> {
  const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
  const finalName = String(newName || '').trim().slice(0, 8);
  if (!cleanPhone || !finalName) return finalName;

  // 1. Update in-memory registry and authoritative mapping
  driverCustomNameRegistry.set(cleanPhone, finalName);
  AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] = finalName;

  // 2. Persist to localStorage keys
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`dd_driver_name_${cleanPhone}`, finalName);
      localStorage.setItem(`dd_admin_name_${cleanPhone}`, finalName);
      localStorage.setItem(`dd_custom_app_name_${cleanPhone}`, finalName);
      localStorage.setItem(`dd_applicant_name_${cleanPhone}`, finalName);
      localStorage.setItem(`dd_user_name_${cleanPhone}`, finalName);
      localStorage.setItem(`dd_squad_member_${cleanPhone}`, JSON.stringify({ name: finalName, driverName: finalName, realName: finalName, phone: cleanPhone }));

      // Check if this is the active user
      const currentUserPhone = (localStorage.getItem('dd_user_phone') || '').replace(/\D/g, '').trim();
      if (currentUserPhone === cleanPhone || cleanPhone === '15509601222') {
        localStorage.setItem('dd_admin_name', finalName);
        localStorage.setItem('dd_user_name', finalName);
      }

      // Update in dd_squad_members_v2
      try {
        const savedMembers = JSON.parse(localStorage.getItem('dd_squad_members_v2') || '[]');
        if (Array.isArray(savedMembers)) {
          const updated = savedMembers.map((m: any) => {
            const mPhone = String(m?.phone || m?.id || '').replace(/\D/g, '').trim();
            if (mPhone === cleanPhone) {
              return { ...m, name: finalName, driverName: finalName, realName: finalName, applicantName: finalName };
            }
            return m;
          });
          localStorage.setItem('dd_squad_members_v2', JSON.stringify(updated));
        }
      } catch (_) {}

      // Update in dd_applicants_v2
      try {
        const savedApps = JSON.parse(localStorage.getItem('dd_applicants_v2') || '[]');
        if (Array.isArray(savedApps)) {
          const updatedApps = savedApps.map((a: any) => {
            const aPhone = String(a?.phone || a?.id || '').replace(/\D/g, '').trim();
            if (aPhone === cleanPhone) {
              return { ...a, name: finalName, driverName: finalName, realName: finalName, applicantName: finalName };
            }
            return a;
          });
          localStorage.setItem('dd_applicants_v2', JSON.stringify(updatedApps));
        }
      } catch (_) {}

      // Broadcast window events for instant multi-view reactive updates
      window.dispatchEvent(new CustomEvent('driver_name_changed', { detail: { phone: cleanPhone, name: finalName } }));
      window.dispatchEvent(new CustomEvent('squad_members_updated', { detail: { phone: cleanPhone, name: finalName } }));
    } catch (_) {}
  }

  // 3. Persist to Alibaba Cloud Baota REST API & MySQL
  try {
    const baseUrl = getBaseApiUrl();
    fetch(`${baseUrl}/api/driver/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cleanPhone, name: finalName })
    }).catch(() => {});
  } catch (_) {}

  // 4. Update dbProxy / Firestore collections
  try {
    const timeStr = new Date().toLocaleString();
    const updatePayload = {
      name: finalName,
      driverName: finalName,
      realName: finalName,
      applicantName: finalName,
      lastUpdatedTime: timeStr
    };
    setDoc(doc(db, 'driver_users', cleanPhone), updatePayload, { merge: true }).catch(() => {});
    setDoc(doc(db, 'driver_locations', cleanPhone), { driverName: finalName, name: finalName }, { merge: true }).catch(() => {});
    setDoc(doc(db, 'online_applications', cleanPhone), updatePayload, { merge: true }).catch(() => {});

    let isRemovedName = false;
    try {
      const savedR = typeof window !== 'undefined' ? localStorage.getItem('dd_removed_squad_phones_v2') : null;
      if (savedR && JSON.parse(savedR).includes(cleanPhone)) isRemovedName = true;
    } catch (_) {}
    
    let isMemberInLocalList = false;
    try {
      const savedM = typeof window !== 'undefined' ? localStorage.getItem('dd_squad_members_v2') : null;
      if (savedM) {
        const list = JSON.parse(savedM);
        if (Array.isArray(list)) {
          isMemberInLocalList = list.some((m: any) => String(m.phone || m.id).replace(/\D/g, '').trim() === cleanPhone);
        }
      }
    } catch (_) {}

    const isInSquadName = cleanPhone === '15509601222' || isMemberInLocalList || (!isRemovedName && (
      typeof window !== 'undefined' && (
        localStorage.getItem(`dd_approved_${cleanPhone}`) === 'true' ||
        localStorage.getItem(`dd_in_squad_${cleanPhone}`) === 'true'
      )
    ));

    if (isInSquadName && !isRemovedName) {
      if (db) {
        setDoc(doc(db, 'squad_members', cleanPhone), updatePayload, { merge: true }).catch(() => {});
        setDoc(doc(db, 'squad_applications', cleanPhone), updatePayload, { merge: true }).catch(() => {});
      }
      try {
        const baseUrl = getBaseApiUrl();
        fetch(`${baseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'squad_members', docId: cleanPhone, data: updatePayload })
        }).catch(() => {});
        fetch(`${baseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'squad_applications', docId: cleanPhone, data: updatePayload })
        }).catch(() => {});
      } catch (_) {}
    }
  } catch (_) {}

  return finalName;
}

/**
 * 格式化司机隐藏名字为“X师傅”或“前缀+X师傅”：
 * 规则：
 * 1. 只有司机本人在自己手机上查看自己时显示全名（如“吴彦祖 (我)”）；
 * 2. 在其他人的手机上，以及查看其他司机时，统一显示为隐藏称呼（如“李师傅”、“王师傅”）；
 * 3. 若名字带有编号或前缀（如“A李扬”、“B李扬”、“A-李扬”），转换为“A李师傅”、“B李师傅”；
 * 4. 若名字带有后缀（如“李扬A”、“李扬B”），转换为“A李师傅”、“B李师傅”；
 * 5. 复姓支持（如“欧阳修” -> “欧阳师傅”）。
 */
export function formatDriverMaskedName(rawName?: string | null): string {
  if (!rawName) return '代驾师傅';
  const trimmed = String(rawName).trim();
  if (!trimmed) return '代驾师傅';

  // 已包含“师傅”后缀
  if (trimmed.endsWith('师傅')) return trimmed;

  // 手机号或特殊编号如 "司机5678" -> 绝不能直接显示 "司机5678" 或 "司机6333"，统一转为 "代驾师傅"
  if (/^司机\d+$/.test(trimmed)) return '代驾师傅';
  if (/^\d{11}$/.test(trimmed)) return '代驾师傅';

  // 检查是否带有后缀字母/数字，例如 "李扬A" -> prefix = "A", base = "李扬"
  let workingName = trimmed;
  let prefix = '';
  const suffixMatch = workingName.match(/^(.*?)([A-Za-z0-9])$/);
  if (suffixMatch && suffixMatch[1] && /[\u4e00-\u9fa5]/.test(suffixMatch[1])) {
    prefix = suffixMatch[2].toUpperCase();
    workingName = suffixMatch[1].trim();
  }

  // 检查是否带有前缀，例如 "A李扬", "B-李扬", "小队1-李扬"
  const prefixMatch = workingName.match(/^([a-zA-Z0-9_\-—#·\s]+|.+[-_—#])([\u4e00-\u9fa5]+.*)$/);
  if (prefixMatch) {
    prefix = (prefix ? `${prefixMatch[1]}${prefix}` : prefixMatch[1]).trim();
    workingName = prefixMatch[2].trim();
  }

  // 提取中文姓氏部分
  const chineseOnly = workingName.match(/[\u4e00-\u9fa5]+/);
  if (chineseOnly) {
    const chStr = chineseOnly[0];
    // 检查是否为复姓
    const compound = COMPOUND_SURNAMES.find(s => chStr.startsWith(s));
    if (compound) {
      return `${prefix}${compound}师傅`;
    }
    // 单姓：取第一个汉字
    const surname = chStr[0];
    return `${prefix}${surname}师傅`;
  }

  return `${prefix}${workingName}师傅`;
}

export function isGenericDriverName(name?: string | null, phone?: string | null): boolean {
  const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
  // 权威真实小队司机绝不属于通用司机
  if (cleanPhone && (AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] || cleanPhone === '15509601222')) {
    return false;
  }
  if (!cleanPhone || cleanPhone.length !== 11) return true;

  if (!name || typeof name !== 'string') {
    return true;
  }
  const str = String(name).trim();
  if (!str) {
    return true;
  }
  if (str === '代驾司机' || str === '在线代驾司机' || str === '司机' || str === '未命名' || str === '代驾师傅' || str === '虚拟司机') return true;
  if (/^司机\d+$/.test(str)) return true;
  if (cleanPhone && (str === `司机${cleanPhone.slice(-4)}` || str.endsWith(cleanPhone.slice(-4)))) {
    return true;
  }
  return false;
}

/**
 * 权威解析指定手机号司机的真实姓名：
 * 1. 优先读取权威真实姓名清单（如 14709696333 为“王贤亮”，15209678783 为“禹全江”，15378921387 为“王灵”等）
 * 2. 优先读取全局内存登记与专属存储中最新的自定义名字
 * 3. 默认兜底：15509601222 为“吴彦祖”，15121904440/18695119126 为“李扬”
 * 4. 严禁对小队内已有真实名字的司机回退为“司机XXXX”！
 */
export function resolveDriverRealName(
  phone?: string | null,
  candidateName?: string | null,
  settings?: any
): string {
  const rawStr = String(phone || '').trim();
  if (rawStr.toUpperCase().endsWith('A')) {
    const rawNum = rawStr.replace(/A$/i, '').replace(/\D/g, '');
    const candidateStr = String(candidateName || '').trim();
    if (candidateStr && !candidateStr.startsWith('司机') && !candidateStr.startsWith('driver')) {
      return candidateStr;
    }
    return `商户${rawNum ? rawNum + 'A' : rawStr}`;
  }

  const cleanPhone = rawStr.replace(/\D/g, '').trim();
  if (!cleanPhone) return '代驾司机';

  const isWu = cleanPhone === '15509601222';
  if (isWu) return '吴彦祖';

  const isValidCustomName = (name?: string | null): boolean => {
    if (!name) return false;
    const str = String(name).trim();
    if (!str) return false;
    if (str === '代驾司机' || str === '在线代驾司机' || str === '司机' || str === '未命名' || str === '虚拟司机' || str === '代驾师傅') return false;
    if (str.includes('商户') || str.includes('商家') || str.includes('店铺') || str.includes('门店')) return false;
    if (!isWu && (str === '吴彦祖' || str === '吴师傅')) return false;
    if (/^司机/i.test(str) || /^driver/i.test(str)) return false;
    if (/^\d+[a-zA-Z]?$/.test(str) || /\d{3,}[a-zA-Z]?$/i.test(str)) return false;
    return true;
  };

  // 1. 优先检查全局内存注册表（已通过 updateDriverGlobalName 或 registerDriverCustomName 改名过）
  if (driverCustomNameRegistry.has(cleanPhone)) {
    const regName = driverCustomNameRegistry.get(cleanPhone);
    if (isValidCustomName(regName)) {
      AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] = regName!;
      return regName!;
    }
  }

  // 2. 检查传入的候选名字（如果组件传来了最新的有效改名）
  const cleanCandidate = String(candidateName || '').trim();
  if (isValidCustomName(cleanCandidate)) {
    driverCustomNameRegistry.set(cleanPhone, cleanCandidate);
    AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] = cleanCandidate;
    return cleanCandidate;
  }

  // 3. 检查 localStorage 专属与全局存储
  if (typeof window !== 'undefined') {
    const phoneSpecificName =
      localStorage.getItem(`dd_driver_name_${cleanPhone}`) ||
      localStorage.getItem(`dd_admin_name_${cleanPhone}`) ||
      localStorage.getItem(`dd_custom_app_name_${cleanPhone}`) ||
      localStorage.getItem(`dd_applicant_name_${cleanPhone}`) ||
      localStorage.getItem(`dd_user_name_${cleanPhone}`);
    if (isValidCustomName(phoneSpecificName)) {
      driverCustomNameRegistry.set(cleanPhone, phoneSpecificName!);
      AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] = phoneSpecificName!;
      return phoneSpecificName!;
    }

    try {
      const smRaw = localStorage.getItem(`dd_squad_member_${cleanPhone}`);
      if (smRaw) {
        const smObj = JSON.parse(smRaw);
        const nameVal = smObj?.name || smObj?.driverName || smObj?.realName;
        if (isValidCustomName(nameVal)) {
          driverCustomNameRegistry.set(cleanPhone, nameVal);
          AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] = nameVal;
          return nameVal;
        }
      }
    } catch (_) {}

    try {
      const appRaw = localStorage.getItem('dd_applicants_v2') || localStorage.getItem('dd_squad_members_v2');
      if (appRaw) {
        const appList = JSON.parse(appRaw);
        if (Array.isArray(appList)) {
          const match = appList.find((item: any) => {
            const p = String(item?.phone || item?.id || '').replace(/\D/g, '').trim();
            return p === cleanPhone;
          });
          if (match) {
            const nameVal = match.name || match.driverName || match.realName || match.applicantName;
            if (isValidCustomName(nameVal)) {
              driverCustomNameRegistry.set(cleanPhone, nameVal);
              AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone] = nameVal;
              return nameVal;
            }
          }
        }
      }
    } catch (_) {}
  }

  // 4. 默认兜底：读取 AUTHORITATIVE_REAL_DRIVER_NAMES
  if (AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone]) {
    const authName = AUTHORITATIVE_REAL_DRIVER_NAMES[cleanPhone];
    driverCustomNameRegistry.set(cleanPhone, authName);
    return authName;
  }

  if (isWu) return '吴彦祖';
  return `司机${cleanPhone.slice(-4)}`;
}

/**
 * 手机号脱敏/加密显示格式化：例如 15509601222 -> 155****1222
 */
export function formatMaskedPhone(phone?: string | null): string {
  if (!phone) return '****';
  const clean = String(phone).replace(/\D/g, '').trim();
  if (clean.length === 11) {
    return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
  }
  if (clean.length >= 7) {
    return `${clean.slice(0, 3)}****${clean.slice(-2)}`;
  }
  return clean || '****';
}

/**
 * 成员列表及申请审批列表中手机号显示规则：
 * 只有小队内其他管理人员/成员看见的手机号码，只对 15509601222 实行脱敏显示 155****1222；
 * 其他司机（例如 15121904440、18695119126 等）的手机号码一律不实行脱敏，正常显示完整手机号。
 * 若当前登录 App 的账号本身就是 15509601222，则看自己也显示完整手机号 15509601222。
 */
export function formatMemberDisplayPhone(targetPhone?: string | null, currentAppUserPhone?: string | null): string {
  if (!targetPhone) return '';
  const cleanTarget = String(targetPhone).replace(/\D/g, '').trim();
  const cleanCurrent = String(currentAppUserPhone || '').replace(/\D/g, '').trim();

  // 只有目标手机号是 15509601222，且当前登录账号不是 15509601222 时，才进行脱敏
  if (cleanTarget === '15509601222' && cleanCurrent !== '15509601222') {
    return formatMaskedPhone(targetPhone);
  }
  return String(targetPhone);
}

/**
 * 判断某个目标手机号对于当前登录用户是否处于脱敏隐藏状态（如 15509601222 被脱敏时为 true）
 */
export function isPhoneMaskedForUser(targetPhone?: string | null, currentAppUserPhone?: string | null): boolean {
  if (!targetPhone) return false;
  const cleanTarget = String(targetPhone).replace(/\D/g, '').trim();
  const cleanCurrent = String(currentAppUserPhone || '').replace(/\D/g, '').trim();
  return cleanTarget === '15509601222' && cleanCurrent !== '15509601222';
}

/**
 * 格式化派单人名称：
 * - 软件app里商户代叫下单：例如 15509601222商户代叫下单就显示派单人：吴彦祖1222；18695119126下单显示：李扬9126
 * - 商户代叫（手机网页版）下单：例如 15509601222/15509601222A下单显示：商户商家1222
 */
export function getFormattedDispatcherName(order: any, activePhoneFallback?: string): string {
  if (!order) return '商户商家';

  const rawPhone = String(
    order.dispatchedByPhone ||
    order.adminPhone ||
    order.merchantPhone ||
    order.creatorPhone ||
    order.reporterPhone ||
    activePhoneFallback ||
    ''
  ).trim();

  const digitsOnly = rawPhone.replace(/\D/g, '');
  const phoneLast4 = digitsOnly.length >= 4 ? digitsOnly.slice(-4) : (digitsOnly || '5552');

  // 区分是【软件app里商户代叫下单】还是【手机网页版商户代叫下单】：
  // 如果带有 app 渠道标识，则绝对是软件app里下的单
  const isExplicitAppOrder = Boolean(
    order.orderChannel === 'app' ||
    order.dispatchChannel === 'app' ||
    order.sourceChannel === 'app' ||
    order.channel === 'app'
  );

  const isWebMerchant = !isExplicitAppOrder && Boolean(
    order.isStandaloneMerchantWeb ||
    order.isWebMerchant ||
    order.sourceChannel === 'web_merchant' ||
    order.dispatchChannel === 'web_merchant' ||
    order.channel === 'web' ||
    order.source === 'web' ||
    rawPhone.toUpperCase().endsWith('A') ||
    String(order.dispatchedByName || '').startsWith('商户商家') ||
    String(order.dispatchedByName || '').startsWith('网页商户商家') ||
    String(order.adminName || '').startsWith('商户商家') ||
    String(order.adminName || '').startsWith('网页商户商家')
  );

  if (isWebMerchant) {
    return `商户商家${phoneLast4}`;
  }

  // App 派单人解析：软件app里商户代叫下单显示为 “吴彦祖1222” 或 “李扬9126” 这种格式
  const rawName = order.adminName || order.dispatchedByName;
  const resolvedName = resolveDriverRealName(digitsOnly, rawName);

  if (resolvedName.endsWith(phoneLast4)) {
    return resolvedName;
  }
  return `${resolvedName}${phoneLast4}`;
}

/**
 * Extracts the base name by removing a trailing single uppercase letter (A-Z) suffix.
 * e.g., "张大帅A" -> "张大帅", "张大帅" -> "张大帅"
 */
export function getBaseName(name: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*?)[A-Z]$/);
  return match ? match[1] : trimmed;
}

/**
 * Scans all online applications, groups duplicate names, and resolves suffixes ('A', 'B', 'C'...)
 * based on their registration order (createdAt). It then updates the Firestore documents in
 * both `online_applications` and `driver_users` to keep everything in real-time sync.
 */
export async function resolveAndSyncDuplicateNames(): Promise<void> {
  try {
    const q = collection(db, 'online_applications');
    const snapshot = await getDocs(q);
    const docsList: any[] = [];
    
    snapshot.forEach((docSnap) => {
      docsList.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (docsList.length === 0) return;

    // Group documents by their normalized base name
    const groups: { [key: string]: any[] } = {};
    docsList.forEach(app => {
      const name = app.driverName || '未命名';
      const base = getBaseName(name);
      if (!groups[base]) {
        groups[base] = [];
      }
      groups[base].push(app);
    });

    // Process each name group
    for (const base of Object.keys(groups)) {
      const list = groups[base];
      
      if (list.length > 1) {
        // There are duplicates! Sort chronologically by registration time (createdAt)
        list.sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          if (timeA !== timeB) return timeA - timeB;
          return a.id.localeCompare(b.id);
        });

        for (let i = 0; i < list.length; i++) {
          const app = list[i];
          const expectedName = base + String.fromCharCode(65 + i); // 65 is 'A', then 'B', 'C'...
          
          if (app.driverName !== expectedName) {
            // Update in online_applications
            const appRef = doc(db, 'online_applications', app.id);
            await setDoc(appRef, {
              driverName: expectedName,
              updatedAt: new Date().toISOString()
            }, { merge: true });

            // Sync with driver_users if approved
            const driverRef = doc(db, 'driver_users', app.id);
            await setDoc(driverRef, {
              driverName: expectedName,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        }
      } else {
        // Only a single driver has this base name. Remove any trailing A-Z suffix if present
        const app = list[0];
        if (app.driverName !== base) {
          // Update in online_applications
          const appRef = doc(db, 'online_applications', app.id);
          await setDoc(appRef, {
            driverName: base,
            updatedAt: new Date().toISOString()
            }, { merge: true });

          // Sync with driver_users
          const driverRef = doc(db, 'driver_users', app.id);
          await setDoc(driverRef, {
            driverName: base,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      }
    }
  } catch (error) {
    console.error("Error resolving duplicate driver names:", error);
  }
}

/**
 * Picks the authoritative VIP expiry date string among candidate dates/strings in precedence order.
 * Respects the first non-empty valid expiry provided by the primary source.
 */
export function pickAuthoritativeVipExpiry(...expiries: (string | undefined | null)[]): string {
  for (const exp of expiries) {
    if (exp !== undefined && exp !== null) {
      const trimmed = String(exp).trim();
      if (trimmed !== '') {
        return trimmed;
      }
    }
  }
  return '待开通';
}

/**
 * 将会员有效期标准化为显示值：2099年及以后的日期统一转为"永久有效"，
 * 避免界面出现 2099-12-31 / 26745天 这类不一致显示。
 */
export function normalizeExpiryForDisplay(expiry?: string | null): string {
  if (!expiry) return '待开通';
  const trimmed = String(expiry).trim();
  if (trimmed === '永久有效' || trimmed === '永久' || trimmed === 'permanent' || trimmed === '终身') {
    return '永久有效';
  }
  const match = trimmed.match(/^(\d{4})[-/]\d{1,2}[-/]\d{1,2}/);
  if (match && parseInt(match[1], 10) >= 2099) {
    return '永久有效';
  }
  return trimmed;
}

/**
 * Standardized VIP remaining days calculation.
 * Ensures 100% mathematical & timezone consistency across Admin Panel, Driver App, and Backend.
 */
export function calculateDaysFromExpiry(expiry?: string): string {
  if (!expiry) return '0';
  const trimmed = String(expiry).trim();
  if (trimmed === '永久有效' || trimmed === '永久' || trimmed === 'permanent' || trimmed === '终身') return '永久';
  if (!trimmed || trimmed === '待开通' || trimmed === '待激活' || trimmed === '未激活' || trimmed === '未开通' || trimmed === '0' || trimmed === '0天' || trimmed === '已到期' || trimmed === '已过期') return '0';

  const pureNumMatch = trimmed.match(/^(\d+)(?:天)?$/);
  if (pureNumMatch) {
    const num = parseInt(pureNumMatch[1], 10);
    return num > 0 ? String(num) : '0';
  }

  try {
    let year = 0, month = 0, day = 0;
    const match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      year = parseInt(match[1], 10);
      month = parseInt(match[2], 10) - 1;
      day = parseInt(match[3], 10);
    } else {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        year = parsed.getFullYear();
        month = parsed.getMonth();
        day = parsed.getDate();
      } else {
        return '0';
      }
    }

    const expDate = new Date(year, month, day, 0, 0, 0, 0);
    // 2099年及以上视为永久有效，不计算天数
    if (year >= 2099) return '永久';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const diffTime = expDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    // 超过100年也视为永久
    if (diffDays > 36500) return '永久';

    return diffDays > 0 ? String(diffDays) : '0';
  } catch (_) {
    return '0';
  }
}

// 补缺失的导出（2026-10-10修复：stash版本引用了不存在的函数）
export function isMerchantAccountUnified(drv: any): boolean {
  if (!drv) return false;
  const phone = String(drv.phone || drv.id || '');
  if (phone.toUpperCase().endsWith('A')) return true;
  if (drv.isMerchant === true || drv.accountType === 'merchant') return true;
  if (drv.role === '商户' || drv.role === '商家' || drv.role === '商户、商家') return true;
  return false;
}

export function isSquadAppPending(status: any): boolean {
  const s = String(status || '').trim();
  return s === '待审核' || s === 'pending' || s === '审核中';
}
