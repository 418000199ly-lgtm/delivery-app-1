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
