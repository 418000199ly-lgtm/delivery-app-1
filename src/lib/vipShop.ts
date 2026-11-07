// VIP 会员自助购买：价格配置读取 + 支付宝下单/查单
// 服务端契约（2026-11-07 定）：
// - GET  /api/shop/vip-packages            → { ok:true, packages:[{id,days,price,label}] }（days=99999 表示永久）
// - POST /api/admin/vip-packages（管理鉴权） body { packages:[...] }
// - POST /api/pay/alipay/create-order（司机 token） body { packageId } → { ok:true, outTradeNo, orderString }
// - GET  /api/pay/order-status?outTradeNo=（司机 token） → { ok:true, status:'pending'|'paid', vipExpiry }
// 到账只认服务端异步通知：客户端拉起支付宝后必须轮询 order-status 确认 paid，绝不凭 SDK 回调直接发权益。
import { getBaseApiUrl, getAuthHeaders } from './dbProxy';

export interface VipPackage {
  id: string;
  days: number; // 99999 = 永久
  price: number;
  label: string;
}

// 内置默认 5 档：服务端读价失败（离线/未部署新接口）时的兜底展示，与 2026-11 前 App 写死价一致
export const DEFAULT_VIP_PACKAGES: VipPackage[] = [
  { id: 'lifetime', days: 99999, price: 158, label: '永久会员' },
  { id: '365days', days: 365, price: 78, label: '365天' },
  { id: '180days', days: 180, price: 45, label: '180天' },
  { id: '90days', days: 90, price: 25, label: '90天' },
  { id: '30days', days: 30, price: 9.9, label: '30天' },
];

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sanitizePackages(raw: any): VipPackage[] {
  if (!Array.isArray(raw)) return [];
  const out: VipPackage[] = [];
  for (const p of raw) {
    const days = Number(p?.days);
    const price = Number(p?.price);
    if (!p?.id || !isFinite(days) || days <= 0 || !isFinite(price) || price < 0) continue;
    out.push({ id: String(p.id), days, price, label: String(p?.label || '') });
  }
  return out;
}

/** 读取会员价格配置；失败/为空时回退内置默认 5 档，永不抛错（购买页不能白屏）。 */
export async function fetchVipPackages(): Promise<VipPackage[]> {
  try {
    const res = await fetchWithTimeout(
      `${getBaseApiUrl()}/api/shop/vip-packages`,
      { headers: { ...getAuthHeaders() }, cache: 'no-store' },
      5000
    );
    const j = await res.json().catch(() => null);
    const pkgs = sanitizePackages(j?.packages);
    if (res.ok && j?.ok && pkgs.length > 0) return pkgs;
  } catch (_) {}
  return DEFAULT_VIP_PACKAGES;
}

/** 管理后台保存会员价格配置；失败抛错，由调用方 toast 呈现。 */
export async function updateVipPackages(packages: VipPackage[]): Promise<void> {
  const res = await fetchWithTimeout(
    `${getBaseApiUrl()}/api/admin/vip-packages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ packages }),
    },
    10000
  );
  const j = await res.json().catch(() => null);
  if (!res.ok || !(j?.ok || j?.success)) {
    throw new Error(j?.error || `保存失败（服务端返回 ${res.status}）`);
  }
}

/** 创建支付宝 App 支付订单；价格以服务端配置为准，客户端只传 packageId。 */
export async function createAlipayOrder(packageId: string): Promise<{ outTradeNo: string; orderString: string }> {
  const res = await fetchWithTimeout(
    `${getBaseApiUrl()}/api/pay/alipay/create-order`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ packageId }),
    },
    15000
  );
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok || !j.orderString) {
    throw new Error(j?.error || `创建支付订单失败（服务端返回 ${res.status}）`);
  }
  return { outTradeNo: String(j.outTradeNo || ''), orderString: String(j.orderString) };
}

/** 查询订单支付状态；paid 时 vipExpiry 为服务端发放后的最新会员有效期。 */
export async function getPayOrderStatus(outTradeNo: string): Promise<{ status: 'pending' | 'paid'; vipExpiry: string }> {
  const res = await fetchWithTimeout(
    `${getBaseApiUrl()}/api/pay/order-status?outTradeNo=${encodeURIComponent(outTradeNo)}`,
    { headers: { ...getAuthHeaders() }, cache: 'no-store' },
    8000
  );
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) {
    throw new Error(j?.error || `查询支付状态失败（服务端返回 ${res.status}）`);
  }
  return {
    status: j.status === 'paid' ? 'paid' : 'pending',
    vipExpiry: String(j.vipExpiry || ''),
  };
}
