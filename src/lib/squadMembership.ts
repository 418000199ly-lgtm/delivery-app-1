// 2026-10-20 重建：小队成员状态统一模块（App 端唯一判定口径）
// 规则与服务端 getUnifiedMembership 完全一致：
// - 成员事实只认服务端 squad_members 本人文档（status=已通过）
// - 申请事实只认服务端 squad_applications 本人文档（status=待审核/已拒绝）
// - removed 名单只认服务端 config/removed_squad_members
// - 开发者 15509601222 恒为成员、豁免 removed 名单
// 本地缓存不参与判定：本模块不读任何 localStorage 状态标记。
import { db, doc, getDoc, onSnapshot, getAuthHeaders, getBaseApiUrl } from './dbProxy';

export const DEVELOPER_PHONE_CLIENT = '15509601222';

export type SquadPhase = 'unknown' | 'none' | 'pending' | 'approved' | 'rejected' | 'removed';

export interface SquadMembershipState {
  phone: string;
  phase: SquadPhase;
  isMember: boolean;
  isDeveloper: boolean;
  isRemoved: boolean;
  member: any | null;
  application: any | null;
  rejectionReason: string;
  loaded: boolean;
}

const APPROVED_STATUSES = ['已通过', 'approved', '通过'];
const PENDING_STATUSES = ['待审核', 'pending', '审核中'];

export function cleanPhoneClient(v: any): string {
  return String(v ?? '').replace(/\D/g, '').trim();
}

export function computeSquadMembership(
  phone: any,
  memberDoc: any | null,
  applicationDoc: any | null,
  removedPhones: any[] | null | undefined,
  loaded = true
): SquadMembershipState {
  const p = cleanPhoneClient(phone);
  const isDeveloper = p === DEVELOPER_PHONE_CLIENT;
  const removedList = Array.isArray(removedPhones) ? removedPhones.map(cleanPhoneClient) : [];
  const isRemoved = !isDeveloper && !!p && removedList.includes(p);
  const mStatus = String(memberDoc?.status || memberDoc?.approvalStatus || '').trim();
  const isMember = isDeveloper || (!isRemoved && !!memberDoc && APPROVED_STATUSES.includes(mStatus));
  const aStatus = String(applicationDoc?.status || applicationDoc?.approvalStatus || '').trim();
  let phase: SquadPhase = 'none';
  if (!loaded) phase = 'unknown';
  else if (isMember) phase = 'approved';
  else if (PENDING_STATUSES.includes(aStatus)) phase = 'pending';
  else if (aStatus === '已拒绝') phase = 'rejected';
  else if (isRemoved) phase = 'removed';
  return {
    phone: p,
    phase,
    isMember,
    isDeveloper,
    isRemoved,
    member: memberDoc ?? null,
    application: applicationDoc ?? null,
    rejectionReason: String(applicationDoc?.rejectionReason || ''),
    loaded,
  };
}

// 订阅本人状态：成员表 + 申请表 + removed 名单，三路服务端订阅合并为一个状态
export function subscribeSquadMembership(
  phone: any,
  cb: (state: SquadMembershipState) => void
): () => void {
  const p = cleanPhoneClient(phone);
  if (!p) {
    cb(computeSquadMembership('', null, null, [], false));
    return () => {};
  }
  let memberDoc: any = null;
  let applicationDoc: any = null;
  let removedPhones: any[] = [];
  let seenMember = false;
  let seenApp = false;
  let seenRemoved = false;
  const emit = () => {
    cb(computeSquadMembership(p, memberDoc, applicationDoc, removedPhones, seenMember && seenApp && seenRemoved));
  };
  const unsubs: any[] = [
    onSnapshot(doc(db, 'squad_members', p), (snap: any) => {
      seenMember = true;
      memberDoc = snap && snap.exists() ? snap.data() : null;
      emit();
    }, () => { seenMember = true; emit(); }),
    onSnapshot(doc(db, 'squad_applications', p), (snap: any) => {
      seenApp = true;
      applicationDoc = snap && snap.exists() ? snap.data() : null;
      emit();
    }, () => { seenApp = true; emit(); }),
    onSnapshot(doc(db, 'config', 'removed_squad_members'), (snap: any) => {
      seenRemoved = true;
      const d = snap && snap.exists() ? snap.data() : null;
      removedPhones = Array.isArray(d?.phones) ? d.phones : [];
      emit();
    }, () => { seenRemoved = true; emit(); }),
  ];
  return () => {
    unsubs.forEach((u) => { try { if (typeof u === 'function') u(); } catch (_) {} });
  };
}

// 一次性读取本人状态（本人操作后立即对账用，不等 5 秒轮询）
export async function fetchSquadMembership(phone: any): Promise<SquadMembershipState> {
  const p = cleanPhoneClient(phone);
  const [m, a, r] = await Promise.all([
    getDoc(doc(db, 'squad_members', p)).catch(() => null),
    getDoc(doc(db, 'squad_applications', p)).catch(() => null),
    getDoc(doc(db, 'config', 'removed_squad_members')).catch(() => null),
  ]);
  const memberDoc = m && m.exists() ? m.data() : null;
  const applicationDoc = a && a.exists() ? a.data() : null;
  const rd = r && r.exists() ? r.data() : null;
  return computeSquadMembership(p, memberDoc, applicationDoc, Array.isArray(rd?.phones) ? rd.phones : [], true);
}

async function postSquadJson(path: string, body: any): Promise<any> {
  const res = await fetch(`${getBaseApiUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    const err: any = new Error(json?.error || `请求失败(${res.status})`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// 提交入队申请（只走服务端专用接口，本地不预写任何状态）
export function submitSquadApplication(payload: { phone: string; name: string; note?: string; city?: string }) {
  return postSquadJson('/api/squad-apply', payload);
}

// 撤回入队申请（服务端删除上次申请记录，双存储）
export function withdrawSquadApplication(phone: string) {
  return postSquadJson('/api/squad-apply/withdraw', { phone });
}
