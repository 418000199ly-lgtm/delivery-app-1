import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    (this as any).state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("AppErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    try {
      (this as any).setState({ hasError: false, error: null });
      if ((this as any).props?.onReset) {
        (this as any).props.onReset();
      }
    } catch (_) {
      window.location.reload();
    }
  };

  private handleFullReset = () => {
    try {
      localStorage.removeItem('dd_current_trip');
      localStorage.removeItem('dd_merchant_orders_v2');
      sessionStorage.clear();
      window.location.reload();
    } catch (_) {
      window.location.reload();
    }
  };

  public render() {
    const inst = this as any;
    if (inst.state?.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen w-full bg-[#07080b] p-6 text-center select-none font-sans text-slate-200">
          <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mb-4 shadow-xl text-amber-400">
            <ShieldAlert className="w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">黑湾代驾视图渲染安全防护</h2>
          <p className="text-xs text-slate-400 mb-6 max-w-sm leading-relaxed">
            {inst.state?.error?.message || "检测到视图渲染发生异常，安全防崩机制已自动拦截白屏现象。"}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>重置并恢复运行</span>
            </button>
            <button
              onClick={this.handleFullReset}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl border border-slate-700 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清理缓存重启</span>
            </button>
          </div>
        </div>
      );
    }

    return inst.props?.children || null;
  }
}

export default AppErrorBoundary;
