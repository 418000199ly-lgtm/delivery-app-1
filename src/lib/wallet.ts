// 司机短信钱包（2026-11-12，照代驾助手Pro模式，用户定案）：
// - 余额只认服务端 driver_wallets 文档，App 只读展示；充值走支付宝 App 支付，
// 到账只认服务端异步通知，客户端拉起支付后轮询 order-status 确认；
// - 服务短信：开始/完成行程时异步调 /api/sms/service-notify，服务端按司机
// 字段开关拼模板变量、VIP 门控、余额预扣/失败回滚，App 端永不阻塞行程、
// 永不抛错（发不发、扣不扣全由服务端决定）。
import { getBaseApiUrl, getAuthHeaders} from './dbProxy';
import { DEFAULT_SMS_SERVICE_CONFIG, type SmsServiceConfig} from '../types';

export interface WalletLogEntry {
id: string;
at: string;
type: 'recharge' | 'sms_charge' | 'sms_refund' | 'admin_adjust' | string;
amountCents: number;
balanceAfterCents?: number;
scene?: string;
orderId?: string;
segments?: number;
status?: string;
note?: string;
ref?: string;
}

export interface WalletMe {
balanceCents: number;
logs: WalletLogEntry[];
smsConfig: SmsServiceConfig;
rechargeAmounts: number[];
smsPriceCents: number;
signName: string;
templatesReady: boolean;
}

export const SMS_SIGN_NAME = '扬湾途信息';
const SMS_START_BODY = '您的代驾服务已经开始，请系好安全带，保管好随身物品。';
const SMS_FINISH_PREFIX = '您的代驾服务已完成，';
const SMS_FINISH_SUFFIX = '感谢您的选择，期待下次再见。';

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
try {
return await fetch(url, {...options, signal: controller.signal});
} finally {
clearTimeout(timer);
}
}

function sanitizeSmsConfig(raw: any): SmsServiceConfig {
const d = DEFAULT_SMS_SERVICE_CONFIG;
if (!raw || typeof raw!== 'object') return {...d, start: {...d.start}, finish: {...d.finish}};
const b = (v: any, dflt: boolean) => (typeof v === 'boolean'? v: dflt);
return {
startEnabled: b(raw.startEnabled, d.startEnabled),
finishEnabled: b(raw.finishEnabled, d.finishEnabled),
start: {
baseFee: b(raw.start?.baseFee, d.start.baseFee),
startTime: b(raw.start?.startTime, d.start.startTime),
},
finish: {
amount: b(raw.finish?.amount, d.finish.amount),
distance: b(raw.finish?.distance, d.finish.distance),
waiting: b(raw.finish?.waiting, d.finish.waiting),
},
};
}

/** 读取我的钱包；失败回退空钱包（余额 0 + 默认配置），永不抛错，页面不能白屏。 */
export async function fetchWalletMe(): Promise<WalletMe> {
const fallback: WalletMe = {
balanceCents: 0,
logs: [],
smsConfig: sanitizeSmsConfig(null),
rechargeAmounts: [10, 20, 50, 100],
smsPriceCents: 15,
signName: SMS_SIGN_NAME,
templatesReady: false,
};
try {
const res = await fetchWithTimeout(
`${getBaseApiUrl()}/api/wallet/me`,
{ headers: {...getAuthHeaders()}, cache: 'no-store'},
6000
);
const j = await res.json().catch(() => null);
if (!res.ok ||!j?.ok) return fallback;
return {
balanceCents: Math.max(0, Math.round(Number(j.balanceCents) || 0)),
logs: Array.isArray(j.logs)? j.logs: [],
smsConfig: sanitizeSmsConfig(j.smsConfig),
rechargeAmounts: Array.isArray(j.rechargeAmounts) && j.rechargeAmounts.length? j.rechargeAmounts.map((n: any) => Number(n)).filter((n: number) => n > 0): fallback.rechargeAmounts,
smsPriceCents: Number(j.smsPriceCents) > 0? Number(j.smsPriceCents): 15,
signName: String(j.signName || SMS_SIGN_NAME),
templatesReady:!!j.templatesReady,
};
} catch (_) {
return fallback;
}
}

/** 保存短信字段开关配置；失败抛错由调用方提示。 */
export async function saveSmsConfig(config: SmsServiceConfig): Promise<SmsServiceConfig> {
const res = await fetchWithTimeout(
`${getBaseApiUrl()}/api/wallet/sms-config`,
{
method: 'POST',
headers: { 'Content-Type': 'application/json',...getAuthHeaders()},
body: JSON.stringify({ config}),
},
10000
);
const j = await res.json().catch(() => null);
if (!res.ok ||!j?.ok) {
throw new Error(j?.error || `保存失败（服务端返回 ${res.status}）`);
}
return sanitizeSmsConfig(j.smsConfig);
}

/** 创建钱包充值支付宝订单；金额只认服务端档位，服务端二次校验。 */
export async function createRechargeOrder(amount: number): Promise<{ outTradeNo: string; orderString: string}> {
const res = await fetchWithTimeout(
`${getBaseApiUrl()}/api/pay/alipay/create-recharge-order`,
{
method: 'POST',
headers: { 'Content-Type': 'application/json',...getAuthHeaders()},
body: JSON.stringify({ amount}),
},
15000
);
const j = await res.json().catch(() => null);
if (!res.ok ||!j?.ok ||!j.orderString) {
throw new Error(j?.error || `创建充值订单失败（服务端返回 ${res.status}）`);
}
return { outTradeNo: String(j.outTradeNo || ''), orderString: String(j.orderString)};
}

/** 查充值订单状态；paid 时 walletBalanceCents 为入账后余额（分）。 */
export async function getRechargeStatus(outTradeNo: string): Promise<{ status: 'pending' | 'paid'; walletBalanceCents: number}> {
const res = await fetchWithTimeout(
`${getBaseApiUrl()}/api/pay/order-status?outTradeNo=${encodeURIComponent(outTradeNo)}`,
{ headers: {...getAuthHeaders()}, cache: 'no-store'},
8000
);
const j = await res.json().catch(() => null);
if (!res.ok ||!j?.ok) {
throw new Error(j?.error || `查询订单状态失败（服务端返回 ${res.status}）`);
}
return {
status: j.status === 'paid'? 'paid': 'pending',
walletBalanceCents: Math.max(0, Math.round(Number(j.walletBalanceCents) || 0)),
};
}

export interface ServiceSmsFields {
baseFee?: number;
amount?: number;
distanceKm?: number;
waitingMin?: number;
startTime?: string;
orderNo?: string;
}

/**
* 触发服务短信（开始/完成）。fire-and-forget：内部吞掉一切错误，
* 调用方不要 await 阻塞行程；发不发由服务端按 VIP/配置/余额决定。
*/
export function notifyServiceSms(payload: {
orderId: string;
scene: 'start' | 'finish';
passengerPhone: string;
fields: ServiceSmsFields;
}): void {
try {
if (!payload.orderId ||!payload.passengerPhone) return;
void fetchWithTimeout(
`${getBaseApiUrl()}/api/sms/service-notify`,
{
method: 'POST',
headers: { 'Content-Type': 'application/json',...getAuthHeaders()},
body: JSON.stringify(payload),
},
10000
).catch(() => {});
} catch (_) {}
}

// ---- 短信预览拼装：与服务端 composeSmsDetail / buildServiceSmsText 逐字同口径 ----
function fmtMoneyShort(n: number): string {
const v = Math.round(Number(n) * 100) / 100;
return String(v);
}

export function composeSmsDetailPreview(
scene: 'start' | 'finish',
cfg: SmsServiceConfig,
f: { baseFee?: number; amount?: number; distanceKm?: number; waitingMin?: number; startTime?: string }
): string {
const MAX = 35;
type Part = { key: string; text: string };
const render = (ps: Part[]) => ps.map((p) => p.text).join('；');
const fit = (parts: Part[], dropOrder: string[], punct: string, fallback: string): string => {
let ps = parts;
while (ps.length > 1) {
const cur = render(ps);
if (cur.length <= MAX - 1) return cur + punct;
if (cur.length <= MAX) return cur;
const dropKey = dropOrder.find((k) => ps.some((p) => p.key === k));
if (!dropKey) break;
ps = ps.filter((p) => p.key !== dropKey);
}
return ps.length ? render(ps).slice(0, MAX) : fallback;
};
if (scene === 'start') {
const all: Part[] = [];
if (cfg.start.baseFee && (f.baseFee || 0) > 0) all.push({ key: 'baseFee', text: `起步费：${fmtMoneyShort(f.baseFee || 0)}元` });
if (cfg.start.startTime && f.startTime) all.push({ key: 'startTime', text: `开始时间：${f.startTime}` });
if (!all.length) return '祝您一路平安。';
return fit(all, ['startTime', 'baseFee'], '。', '祝您一路平安。');
}
const all: Part[] = [];
if (cfg.finish.amount && (f.amount || 0) > 0) all.push({ key: 'amount', text: `金额：${fmtMoneyShort(f.amount || 0)}元` });
if (cfg.finish.distance && (f.distanceKm || 0) > 0) all.push({ key: 'distance', text: `里程：${fmtMoneyShort(Math.round((f.distanceKm || 0) * 100) / 100)}公里` });
if (cfg.finish.waiting && (f.waitingMin || 0) > 0) all.push({ key: 'waiting', text: `等候时间：${Math.round(f.waitingMin || 0)}分钟` });
if (!all.length) return '祝您一路平安，';
return fit(all, ['waiting', 'distance'], '；', '祝您一路平安，');
}

export function buildServiceSmsTextPreview(scene: 'start' | 'finish', detail: string): string {
const body = scene === 'start' ? SMS_START_BODY + detail : SMS_FINISH_PREFIX + detail + SMS_FINISH_SUFFIX;
return '【' + SMS_SIGN_NAME + '】' + body;
}

/** 分段数：含签名 ≤70 字 1 段，超出按 67 字/段（与服务端同口径）。 */
export function smsSegmentsPreview(text: string): number {
const n = text.length;
if (n <= 70) return 1;
return 1 + Math.ceil((n - 70) / 67);
}
