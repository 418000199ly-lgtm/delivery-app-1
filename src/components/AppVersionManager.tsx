// ============================================================
// 2026-11-01 管理后台「App 版本管理」（自更新桥接版配套）。
// 挂在总控（master_controls）页顶部。功能：
// - 查看 downloads/ 目录里的安装包文件（APK/IPA 需先经宝塔上传到
// /www/wwwroot/daijia_server/downloads/）；
// - 发布新版：选文件 + 填构建号/版本名/更新说明，指纹与大小由服务端现算；
// - 开/关强制升级、设灰度比例；
// - 司机版本分布表：谁已升级、谁待升级（数据来自 App 问询上报）。
// 接口：/api/admin/app-version(GET/POST)、/api/admin/app-version-reports。
// ============================================================
import React, { useEffect, useState} from 'react';
import { getBaseApiUrl, getAuthHeaders, db, collection, getDocs} from '../lib/dbProxy';

interface PlatformCfg {
build?: number;
name?: string;
notes?: string;
file?: string;
sha256?: string;
size?: number;
force?: boolean;
rollout?: number;
publishedAt?: number;
publishedBy?: string;
}

export default function AppVersionManager() {
const [platform, setPlatform] = useState<'android' | 'ios'>('android');
const [config, setConfig] = useState<any>({});
const [files, setFiles] = useState<any[]>([]);
const [reports, setReports] = useState<any[]>([]);
const [nameMap, setNameMap] = useState<Record<string, string>>({});
const [loading, setLoading] = useState(false);
const [msg, setMsg] = useState('');
// 表单
const [fFile, setFFile] = useState('');
const [fBuild, setFBuild] = useState('');
const [fName, setFName] = useState('');
const [fNotes, setFNotes] = useState('');
const [fForce, setFForce] = useState(false);
const [fRollout, setFRollout] = useState(100);

const cfg: PlatformCfg = (config && config[platform]) || {};

const loadAll = async () => {
setLoading(true);
try {
const base = getBaseApiUrl();
const r = await fetch(`${base}/api/admin/app-version`, { headers: {...getAuthHeaders()}});
const j = await r.json().catch(() => ({}));
if (j && j.success) {
setConfig(j.config || {});
setFiles(j.files || []);
const c = (j.config || {})[platform] || {};
setFFile(c.file || '');
setFBuild(c.build? String(c.build): '');
setFName(c.name || '');
setFNotes(c.notes || '');
setFForce(!!c.force);
setFRollout(c.rollout!== undefined? Number(c.rollout): 100);
}
const rr = await fetch(`${base}/api/admin/app-version-reports`, { headers: {...getAuthHeaders()}});
const jj = await rr.json().catch(() => ({}));
if (jj && jj.success) setReports(jj.list || []);
// 姓名映射（尽力而为，失败不阻塞）
try {
const snap: any = await getDocs(collection(db, 'squad_members'));
const map: Record<string, string> = {};
snap.forEach((d: any) => {
const data = d.data() || {};
const phone = String(data.phone || d.id || '').replace(/\D/g, '');
if (phone && data.realName) map[phone] = data.realName;
});
setNameMap(map);
} catch (_) {}
} catch (e: any) {
setMsg('加载失败：' + (e?.message || e));
} finally {
setLoading(false);
}
};

useEffect(() => {
loadAll();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [platform]);

const publish = async () => {
const build = parseInt(fBuild, 10);
if (!fFile) { setMsg('请先选择安装包文件（没有文件时，先用宝塔把安装包上传到服务器 downloads/ 目录，再点刷新）'); return;}
if (!build || build <= 0) { setMsg('构建号必须是正整数（填 GitHub 构建序号，如 335）'); return;}
if (cfg.build && build <= Number(cfg.build)) {
if (!window.confirm(`新构建号 ${build} 不大于当前已发布构建号 ${cfg.build}，司机端会认为没有新版。仍要保存吗？`)) return;
}
if (fForce &&!window.confirm('确认开启？下线司机将被要求升级后才能上线（上线跑单中的不打扰）。')) return;
setLoading(true);
setMsg('');
try {
const r = await fetch(`${getBaseApiUrl()}/api/admin/app-version`, {
method: 'POST',
headers: { 'Content-Type': 'application/json',...getAuthHeaders()},
body: JSON.stringify({ platform, file: fFile, build, name: fName, notes: fNotes, force: fForce, rollout: fRollout}),
});
const j = await r.json().catch(() => ({}));
if (!j ||!j.success) throw new Error(j?.error || `HTTP ${r.status}`);
setConfig(j.config || {});
setMsg('✅ 已发布，立即生效（司机 App 一分钟内问询到新版本）');
const rr = await fetch(`${getBaseApiUrl()}/api/admin/app-version-reports`, { headers: {...getAuthHeaders()}});
const jj = await rr.json().catch(() => ({}));
if (jj && jj.success) setReports(jj.list || []);
} catch (e: any) {
setMsg('发布失败：' + (e?.message || e));
} finally {
setLoading(false);
}
};

const toggleForce = async (force: boolean) => {
if (!cfg.file ||!cfg.build) { setMsg('还没有发布过版本，无法切换强制开关'); return;}
if (force &&!window.confirm('确认开启？下线司机将被要求升级后才能上线。')) return;
setLoading(true);
setMsg('');
try {
const r = await fetch(`${getBaseApiUrl()}/api/admin/app-version`, {
method: 'POST',
headers: { 'Content-Type': 'application/json',...getAuthHeaders()},
body: JSON.stringify({ platform, force}),
});
const j = await r.json().catch(() => ({}));
if (!j ||!j.success) throw new Error(j?.error || `HTTP ${r.status}`);
setConfig(j.config || {});
setFForce(force);
setMsg(force? '✅ 强制升级已开启': '✅ 强制升级已关闭');
} catch (e: any) {
setMsg('操作失败：' + (e?.message || e));
} finally {
setLoading(false);
}
};

const latestBuild = Number(cfg.build || 0);
const upgradedCount = reports.filter((x) => Number(x.build || 0) >= latestBuild && latestBuild > 0).length;

const inputCls = 'w-full bg-slate-800/80 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-teal-400/60';
const labelCls = 'block text-xs text-slate-400 mb-1';

return (
<div className="mb-6 rounded-2xl border border-teal-500/25 bg-slate-900/60 p-4 sm:p-5">
<div className="flex flex-wrap items-center justify-between gap-3">
<div>
<div className="text-base font-bold text-teal-300">📱 App 版本管理（自更新）</div>
<div className="mt-0.5 text-xs text-slate-400">
发布新版后，司机 App 每分钟自动问询；强制升级只弹司机，上线跑单不打扰，不升不让上线。
</div>
</div>
<div className="flex items-center gap-2">
<div className="flex rounded-lg overflow-hidden border border-slate-600/60">
<button onClick={() => setPlatform('android')} className={`px-3 py-1.5 text-xs font-semibold ${platform === 'android'? 'bg-teal-500/20 text-teal-300': 'text-slate-400'}`}>安卓</button>
<button onClick={() => setPlatform('ios')} className={`px-3 py-1.5 text-xs font-semibold ${platform === 'ios'? 'bg-teal-500/20 text-teal-300': 'text-slate-400'}`}>苹果</button>
</div>
<button onClick={loadAll} disabled={loading} className="px-3 py-1.5 rounded-lg bg-slate-700/70 text-xs text-slate-200 disabled:opacity-50">刷新</button>
</div>
</div>

{/* 当前线上版本 */}
<div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
<div className="rounded-xl bg-slate-800/70 py-3">
<div className="text-lg font-bold text-slate-100">{cfg.build? `构建 ${cfg.build}`: '未发布'}</div>
<div className="text-[11px] text-slate-400">当前{platform === 'android'? '安卓': '苹果'}版本{cfg.name? `（${cfg.name}）`: ''}</div>
</div>
<div className="rounded-xl bg-slate-800/70 py-3">
<div className={`text-lg font-bold ${cfg.force? 'text-rose-400': 'text-slate-300'}`}>{cfg.force? '强制开启': '强制关闭'}</div>
<div className="text-[11px] text-slate-400">强制升级状态</div>
</div>
<div className="rounded-xl bg-slate-800/70 py-3">
<div className="text-lg font-bold text-slate-100">{cfg.rollout!== undefined? `${cfg.rollout}%`: '100%'}</div>
<div className="text-[11px] text-slate-400">灰度比例</div>
</div>
<div className="rounded-xl bg-slate-800/70 py-3">
<div className="text-lg font-bold text-slate-100">{latestBuild > 0? `${upgradedCount}/${reports.length}`: '—'}</div>
<div className="text-[11px] text-slate-400">已升级/已上报人数</div>
</div>
</div>
{cfg.file && (
<div className="mt-2 text-[11px] text-slate-500 break-all">
文件：{cfg.file}｜大小：{cfg.size? (cfg.size / 1024 / 1024).toFixed(1) + ' MB': '—'}｜指纹：{cfg.sha256? cfg.sha256.slice(0, 16) + '…': '—'}
{cfg.publishedAt? `｜发布于 ${new Date(cfg.publishedAt).toLocaleString('zh-CN')}`: ''}
</div>
)}

{/* 发布表单 */}
<div className="mt-4 grid sm:grid-cols-2 gap-3">
<div>
<label className={labelCls}>安装包文件（服务器 downloads/ 目录）</label>
<select value={fFile} onChange={(e) => setFFile(e.target.value)} className={inputCls}>
<option value="">— 请选择 —</option>
{files.map((f) => (
<option key={f.file} value={f.file}>{f.file}（{(f.size / 1024 / 1024).toFixed(1)} MB）</option>
))}
</select>
{files.length === 0 && <div className="mt-1 text-[11px] text-amber-400/90">目录里还没有文件：先在宝塔文件管理里把安装包上传到 /www/wwwroot/daijia_server/downloads/（没有 downloads 文件夹就新建一个），再点右上角刷新。</div>}
</div>
<div className="grid grid-cols-2 gap-3">
<div>
<label className={labelCls}>构建号（GitHub 构建序号）</label>
<input value={fBuild} onChange={(e) => setFBuild(e.target.value.replace(/\D/g, ''))} placeholder="如 335" className={inputCls} />
</div>
<div>
<label className={labelCls}>显示版本名</label>
<input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="如 2.1.335" className={inputCls} />
</div>
</div>
<div className="sm:col-span-2">
<label className={labelCls}>更新说明（司机弹窗里能看到）</label>
<textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} placeholder="如：修复选单大厅看不见订单的问题，请及时升级" className={inputCls} />
</div>
<div className="flex items-center gap-3">
<label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
<input type="checkbox" checked={fForce} onChange={(e) => setFForce(e.target.checked)} className="w-4 h-4 accent-rose-500" />
发布时开启强制升级
</label>
</div>
<div>
<label className={labelCls}>灰度比例：{fRollout}%（先小比例试发，确认没问题再拉满）</label>
<input type="range" min={0} max={100} step={10} value={fRollout} onChange={(e) => setFRollout(Number(e.target.value))} className="w-full accent-teal-500" />
</div>
</div>

<div className="mt-4 flex flex-wrap items-center gap-2">
<button onClick={publish} disabled={loading} className="px-5 py-2 rounded-xl bg-teal-600 text-sm font-bold text-white hover:bg-teal-500 disabled:opacity-50">保存并发布</button>
{cfg.force? (
<button onClick={() => toggleForce(false)} disabled={loading} className="px-4 py-2 rounded-xl bg-slate-700 text-sm text-slate-100 disabled:opacity-50">关闭强制升级</button>
): (
<button onClick={() => toggleForce(true)} disabled={loading ||!cfg.build} className="px-4 py-2 rounded-xl bg-rose-600/90 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50">对当前版本开启强制升级</button>
)}
{msg && <span className="text-xs text-slate-300">{msg}</span>}
</div>

{/* 司机版本分布 */}
<div className="mt-5">
<div className="text-xs font-semibold text-slate-300 mb-2">司机版本分布（按上报时间倒序，共 {reports.length} 人上报）</div>
{reports.length === 0? (
<div className="text-xs text-slate-500">暂无上报。司机装上桥接版并联网打开 App 后，这里会自动出现。</div>
): (
<div className="max-h-64 overflow-y-auto rounded-xl border border-slate-700/60">
<table className="w-full text-xs">
<thead className="bg-slate-800/80 text-slate-400">
<tr>
<th className="px-3 py-2 text-left font-medium">司机</th>
<th className="px-3 py-2 text-left font-medium">手机号</th>
<th className="px-3 py-2 text-left font-medium">平台</th>
<th className="px-3 py-2 text-left font-medium">构建号</th>
<th className="px-3 py-2 text-left font-medium">状态</th>
<th className="px-3 py-2 text-left font-medium">最后上报</th>
</tr>
</thead>
<tbody>
{reports.map((x) => {
const phone = String(x.phone || '');
const isLatest = latestBuild > 0 && Number(x.build || 0) >= latestBuild;
return (
<tr key={phone} className="border-t border-slate-800 text-slate-300">
<td className="px-3 py-1.5">{nameMap[phone] || '—'}</td>
<td className="px-3 py-1.5">{phone}</td>
<td className="px-3 py-1.5">{x.platform === 'ios'? '苹果': '安卓'}</td>
<td className="px-3 py-1.5">{x.build?? '—'}</td>
<td className="px-3 py-1.5">{latestBuild === 0? '—': isLatest? <span className="text-teal-400">已最新</span>: <span className="text-amber-400">待升级</span>}</td>
<td className="px-3 py-1.5">{x.updatedAt? new Date(x.updatedAt).toLocaleString('zh-CN'): '—'}</td>
</tr>
);
})}
</tbody>
</table>
</div>
)}
</div>
</div>
);
}
