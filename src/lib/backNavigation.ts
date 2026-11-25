// 安卓系统返回键分层处理注册表（2026-11-25）
//
// 背景：司机版此前没有注册 Capacitor backButton 监听，安卓返回键按了没反应。
// 现在 App 层统一监听返回键，消费顺序为：
//   1) 本注册表里各弹窗/覆盖层登记的关闭函数（最后打开的最先消费）；
//   2) App 层页面级兜底（关更新弹窗 → 回首页 / 最小化 / 退出，见 App.tsx）。
// 弹窗组件在打开期间用 registerBackHandler 登记关闭函数、关闭时注销即可，
// 不需要把状态提升到 App 层。

export type BackPressHandler = () => boolean; // 返回 true 表示本次返回键已被消费

interface BackEntry {
  id: number;
  handler: BackPressHandler;
}

let seq = 0;
const stack: BackEntry[] = [];

export function registerBackHandler(handler: BackPressHandler): () => void {
  const id = ++seq;
  stack.push({ id, handler });
  return () => {
    const i = stack.findIndex((e) => e.id === id);
    if (i >= 0) stack.splice(i, 1);
  };
}

// 从最上层（最后登记）开始依次询问，第一个返回 true 的消费本次返回键。
export function dispatchBackPress(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i].handler()) return true;
    } catch (_) {
      // 单个弹窗的关闭函数出错不阻断返回链
    }
  }
  return false;
}
