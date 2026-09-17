import { db, collection, getDocs, doc, setDoc } from '../lib/dbProxy';

/**
 * Common 2-character Chinese compound surnames (复姓)
 */
const COMPOUND_SURNAMES = [
  '欧阳', '诸葛', '司马', '上官', '夏侯', '东方', '独孤', '南宫', '皇甫', '司徒', '尉迟', '公孙', '慕容', '宇文'
];

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

  // 手机号或特殊编号如 "司机5678"
  if (/^司机\d+$/.test(trimmed)) return trimmed;
  if (/^\d{11}$/.test(trimmed)) return `司机${trimmed.slice(-4)}`;

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

/**
 * 权威解析指定手机号司机的真实姓名：
 * 1. 15509601222 默认是“吴彦祖”（支持自定义改名）
 * 2. 其他手机号（如 18695119126）优先读取申请时填写的真实姓名（如“李扬”），绝不与“吴彦祖”混淆
 * 3. 若无任何记录，回退为“司机”+后4位
 */
export function resolveDriverRealName(
  phone?: string | null,
  candidateName?: string | null,
  settings?: any
): string {
  const cleanPhone = String(phone || '').replace(/\D/g, '').trim();
  if (!cleanPhone) return '代驾司机';

  // 15509601222 专属
  const isWu = cleanPhone === '15509601222';
  // 18695119126 / 15121904440 为李扬
  const isLiYang = cleanPhone === '18695119126' || cleanPhone === '15121904440';

  const isValidCustomName = (name?: string | null): boolean => {
    if (!name) return false;
    const str = String(name).trim();
    if (!str) return false;
    if (str === '代驾司机' || str === '在线代驾司机' || str === '司机') return false;
    if (str.startsWith('网页商户商家') || str.startsWith('商户商家')) return false;
    // 非 15509601222 账号绝不能叫“吴彦祖”或“吴师傅”或带有“吴彦祖”
    if (!isWu && (str === '吴彦祖' || str === '吴师傅' || str.includes('吴彦祖'))) return false;
    // 如果是 18695119126，像“司机9126”这种临时兜底名绝不采纳，必须用“李扬”
    if (isLiYang && (/^司机\d{4}$/.test(str) || str === `司机${cleanPhone.slice(-4)}`)) return false;
    return true;
  };

  // 1. 如果有传入非通用候选名字，优先校验
  const cleanCandidate = String(candidateName || '').trim();
  if (isValidCustomName(cleanCandidate)) {
    return cleanCandidate;
  }

  // 2. 检查 settings 中的名字
  if (settings) {
    const sName = String(settings.driverName || settings.name || '').trim();
    if (isValidCustomName(sName)) {
      return sName;
    }
  }

  // 3. 检查 localStorage 针对该手机号的专属存储
  if (typeof window !== 'undefined') {
    const phoneSpecificName =
      localStorage.getItem(`dd_driver_name_${cleanPhone}`) ||
      localStorage.getItem(`dd_applicant_name_${cleanPhone}`) ||
      localStorage.getItem(`dd_custom_app_name_${cleanPhone}`);
    if (isValidCustomName(phoneSpecificName)) {
      return phoneSpecificName!;
    }

    // 检查 dd_squad_member_${cleanPhone}
    try {
      const smRaw = localStorage.getItem(`dd_squad_member_${cleanPhone}`);
      if (smRaw) {
        const smObj = JSON.parse(smRaw);
        const nameVal = smObj?.name || smObj?.driverName || smObj?.realName;
        if (isValidCustomName(nameVal)) {
          return nameVal;
        }
      }
    } catch (_) {}

    // 检查 dd_applicants_v2 / dd_squad_members_v2 列表
    try {
      const appRaw = localStorage.getItem('dd_applicants_v2') || localStorage.getItem('dd_squad_members_v2');
      if (appRaw) {
        const appList = JSON.parse(appRaw);
        if (Array.isArray(appList)) {
          const match = appList.find((item: any) => {
            const p = String(item.phone || item.id || '').replace(/\D/g, '').trim();
            return p === cleanPhone;
          });
          if (match) {
            const mName = match.name || match.driverName || match.realName;
            if (isValidCustomName(mName)) {
              return mName;
            }
          }
        }
      }
    } catch (_) {}
  }

  // 4. 固定账号默认
  if (isWu) {
    return '吴彦祖';
  }
  if (isLiYang) {
    return '李扬';
  }

  // 5. 兜底格式
  return `司机${cleanPhone.slice(-4)}`;
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
