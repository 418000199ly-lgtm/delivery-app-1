/**
 * 前台恢复协调器（修复 App 切后台再返回卡顿）
 *
 * 问题：App 从后台切回前台时，8 个 visibilitychange 监听 + 约15个 dbProxy 数据订阅
 * 同时开火（网络请求/GPS硬件调用/状态同步），主线程被堵死几秒，页面点不动。
 * iOS 和 Android 的 Capacitor WebView 都有此问题（后台时 JS 定时器被节流，
 * 恢复时积压任务集中爆发）。
 *
 * 方案：
 * 1. 全局防抖：300ms 内多次 visible 只触发一次协调刷新
 * 2. 分优先级错峰：关键（订单/鉴权）立即执行，普通数据订阅错峰 0-800ms，
 *    重型（拉全量司机GPS、地图重绘）延迟到 1.5s 后空闲时执行
 * 3. requestIdleCallback 不可用时降级 setTimeout
 */

type ResumeTask = {
  id: string;
  priority: 'critical' | 'normal' | 'heavy';
  fn: () => void | Promise<void>;
};

const PRIORITY_DELAY: Record<ResumeTask['priority'], number> = {
  critical: 0,     // 订单、鉴权类：立即
  normal: 400,     // 普通数据订阅：错峰
  heavy: 1500,     // 全量GPS拉取、地图重绘：空闲时
};

let pendingTasks = new Map<string, ResumeTask>();
let coordinatorTimer: any = null;
let lastResumeAt = 0;

function runIdle(fn: () => void, timeoutMs: number) {
  try {
    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(fn, { timeout: timeoutMs });
      return;
    }
  } catch (_) {}
  setTimeout(fn, Math.min(timeoutMs, 1200));
}

/**
 * 注册一个前台恢复时要执行的任务。同一 id 多次注册会去重（只保留最后一次）。
 * 调用方不要再自己监听 visibilitychange，直接用这个。
 */
export function scheduleResumeTask(id: string, priority: ResumeTask['priority'], fn: () => void | Promise<void>) {
  pendingTasks.set(id, { id, priority, fn });
  // 防抖：300ms 内的重复调度合并
  if (coordinatorTimer) clearTimeout(coordinatorTimer);
  coordinatorTimer = setTimeout(flushResumeTasks, 300);
}

function flushResumeTasks() {
  coordinatorTimer = null;
  const tasks = Array.from(pendingTasks.values());
  pendingTasks.clear();
  if (tasks.length === 0) return;
  lastResumeAt = Date.now();

  // 按优先级分组执行，组内再错峰打散
  const groups: Record<ResumeTask['priority'], ResumeTask[]> = { critical: [], normal: [], heavy: [] };
  for (const t of tasks) groups[t.priority].push(t);

  const runTask = (t: ResumeTask) => {
    try {
      const r = t.fn();
      if (r && typeof (r as any).catch === 'function') (r as any).catch(() => {});
    } catch (_) {}
  };

  // critical：立即（仍用微任务错开，避免同步堆叠）
  groups.critical.forEach((t, i) => setTimeout(() => runTask(t), i * 50));
  // normal：400ms 基础 + 组内每项错开 80ms
  groups.normal.forEach((t, i) => setTimeout(() => runTask(t), PRIORITY_DELAY.normal + i * 80));
  // heavy：丢给空闲回调
  groups.heavy.forEach((t, i) =>
    runIdle(() => runTask(t), PRIORITY_DELAY.heavy + i * 300)
  );
}

/** 距上次前台恢复是否在冷却期内（供高频调用方自查，避免重复拉取） */
export function isWithinResumeCooldown(ms = 2000): boolean {
  return Date.now() - lastResumeAt < ms;
}

/**
 * 一次性全局监听：替代各处分散的 visibilitychange。
 * 保留兼容：各模块仍可调用 scheduleResumeTask 注册自己的恢复任务。
 */
let globalListenerInstalled = false;
export function installGlobalResumeListener() {
  if (globalListenerInstalled || typeof document === 'undefined') return;
  globalListenerInstalled = true;
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      // 只触发协调器防抖窗口；各任务由 scheduleResumeTask 在平时注册好
      if (coordinatorTimer) clearTimeout(coordinatorTimer);
      coordinatorTimer = setTimeout(flushResumeTasks, 300);
    }
  };
  document.addEventListener('visibilitychange', onVis);
}
