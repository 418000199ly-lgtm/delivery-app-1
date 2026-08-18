import React, { useState, useEffect } from 'react';
import { getBaseApiUrl } from '../lib/dbProxy';
import { MessageSquare, CheckCircle2, Smartphone, Loader2, ShieldAlert, Check } from 'lucide-react';

export default function WeChatAuthMobile() {
  const [session, setSession] = useState<string | null>(null);
  const [phone, setPhone] = useState('18609518888'); // Default demo phone
  const [customPhone, setCustomPhone] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    setSession(sessionParam);
  }, []);

  const handleAuthorize = async () => {
    const finalPhone = useCustom ? customPhone.trim() : phone;
    if (!finalPhone) {
      setErrorMessage('请输入或选择手机号码');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(finalPhone)) {
      setErrorMessage('请输入正确的11位中国大陆手机号');
      return;
    }

    if (!session) {
      setErrorMessage('会话标识丢失，无法授权，请重新在电脑端扫码');
      return;
    }

    setErrorMessage('');
    setStatus('submitting');

    try {
      const response = await fetch(`${getBaseApiUrl()}/api/wechat/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session,
          phone: finalPhone,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(data.error || '授权失败，请稍后重试');
      }
    } catch (err: any) {
      console.error('[WeChat Auth Mobile] Error:', err);
      setStatus('error');
      setErrorMessage(err.message || '网络连接超时，请检查网络');
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center text-[#333333]" id="wechat-invalid-session">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-500 mb-4 shadow-sm">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">二维码无效或过期</h2>
        <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
          未检测到有效的微信登录会话参数。请返回电脑端，刷新登录二维码并使用微信重新扫码。
        </p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-6 text-center text-[#333333] animate-in fade-in duration-500" id="wechat-success-screen">
        <div className="flex-1 flex flex-col items-center justify-center py-10">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-500 mb-6 shadow-md">
            <CheckCircle2 className="w-12 h-12 animate-bounce" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">授权登录成功</h2>
          <p className="text-sm text-slate-500 max-w-xs leading-relaxed mb-6">
            您的身份已验证通过！电脑端设备正同步登录中，请直接在电脑端查看。
          </p>
          <div className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            已安全绑定号码：{useCustom ? customPhone : phone}
          </div>
        </div>
        <div className="text-[11px] text-slate-400 py-4 border-t border-slate-200">
          黑湾代驾计费MAX · 安全登录技术支持
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between text-[#333333]" id="wechat-auth-screen">
      
      {/* Scrollable Main Area */}
      <div className="p-6 space-y-8 flex-1">
        
        {/* Top Header WeChat Styled */}
        <div className="text-center pt-8 space-y-4">
          <div className="w-16 h-16 bg-[#07c160] rounded-2xl mx-auto flex items-center justify-center shadow-md text-white">
            <MessageSquare className="w-9 h-9 fill-current" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-slate-900">微信网页授权登录</h1>
            <p className="text-xs text-slate-500">由 黑湾代驾计费MAX 申请提供服务</p>
          </div>
        </div>

        {/* Permissions list */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs text-left">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
            该应用将申请以下权限：
          </h3>
          <ul className="space-y-3 text-xs text-slate-600">
            <li className="flex items-start gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#07c160] mt-1.5 shrink-0" />
              <span>获得您的公开信息（微信昵称、头像、性别及地区）</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#07c160] mt-1.5 shrink-0" />
              <span>使用您的微信绑定手机号，一键核验司机账户信息并安全登录司机端。</span>
            </li>
          </ul>
        </div>

        {/* Identity / Number binding selections */}
        <div className="space-y-4 text-left">
          <label className="text-xs font-bold text-slate-500 tracking-wider block">
            请选择或输入需要登录的司机手机号
          </label>
          
          <div className="space-y-2.5">
            {/* Demo numbers */}
            <button
              type="button"
              onClick={() => {
                setUseCustom(false);
                setPhone('18609518888');
                setErrorMessage('');
              }}
              className={`w-full p-4 border rounded-2xl flex items-center justify-between text-left transition-all ${
                !useCustom && phone === '18609518888'
                  ? 'border-[#07c160] bg-emerald-50/40 text-slate-900 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Smartphone className="w-4 h-4 text-slate-400" />
                <div>
                  <div className="text-xs font-bold font-mono">186 0951 8888</div>
                  <div className="text-[10px] text-slate-400">测试管理员司机</div>
                </div>
              </div>
              {!useCustom && phone === '18609518888' && (
                <div className="w-5 h-5 bg-[#07c160] rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setUseCustom(true);
                setErrorMessage('');
              }}
              className={`w-full p-4 border rounded-2xl flex items-center justify-between text-left transition-all ${
                useCustom
                  ? 'border-[#07c160] bg-emerald-50/40 text-slate-900 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Smartphone className="w-4 h-4 text-slate-400" />
                <div>
                  <div className="text-xs font-bold font-mono">自定义常用手机号</div>
                  <div className="text-[10px] text-slate-400">手动输入手机号码进行授权</div>
                </div>
              </div>
              {useCustom && (
                <div className="w-5 h-5 bg-[#07c160] rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>
              )}
            </button>

            {/* Custom Input Toggle */}
            <div className={`border rounded-2xl overflow-hidden transition-all ${
              useCustom ? 'border-[#07c160] bg-emerald-50/20' : 'border-slate-200 bg-white'
            }`}>
              <button
                type="button"
                onClick={() => {
                  setUseCustom(true);
                  setErrorMessage('');
                }}
                className="w-full p-4 flex items-center justify-between text-left border-b border-dashed border-slate-100"
              >
                <span className="text-xs font-bold text-slate-700">使用其他手机号码登录</span>
                {useCustom && (
                  <div className="w-5 h-5 bg-[#07c160] rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>
                )}
              </button>
              
              {useCustom && (
                <div className="p-4 bg-white animate-in slide-in-from-top-1 duration-200">
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 border-r border-slate-100 pr-2">+86</span>
                    <input
                      type="tel"
                      maxLength={11}
                      value={customPhone}
                      onChange={(e) => {
                        const cleanVal = e.target.value.replace(/\D/g, '');
                        setCustomPhone(cleanVal);
                        setErrorMessage('');
                      }}
                      placeholder="请输入11位中国大陆手机号码"
                      className="w-full pl-14 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-hidden focus:border-[#07c160] focus:bg-white text-slate-800 font-mono tracking-wider"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error messaging */}
        {errorMessage && (
          <div className="p-3.5 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl text-left font-semibold">
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Action button */}
        <div className="pt-4 space-y-3">
          <button
            type="button"
            onClick={handleAuthorize}
            disabled={status === 'submitting'}
            className="w-full py-3.5 bg-[#07c160] hover:bg-[#06ae56] disabled:opacity-50 text-white font-bold text-sm tracking-wide rounded-2xl shadow-md active:scale-98 transition-all flex items-center justify-center gap-1.5 cursor-pointer animate-pulse"
          >
            {status === 'submitting' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                正在授权登录...
              </>
            ) : (
              '同意授权并登录'
            )}
          </button>
          
          <button
            type="button"
            onClick={() => {
              window.close();
              alert('您已取消授权。可返回电脑端使用其他方式登录。');
            }}
            className="w-full py-3.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-sm tracking-wide rounded-2xl transition-colors cursor-pointer"
          >
            拒绝
          </button>
        </div>

      </div>

      {/* Official Footnote */}
      <div className="shrink-0 py-6 px-6 text-center text-[10px] text-slate-400 leading-normal bg-slate-100 border-t border-slate-200/60">
        授权将遵循微信服务协议、个人信息保护规则和黑湾代驾计费MAX司机端隐私政策。您的登录和授权链路受行业顶尖SSL双向密钥保障。
      </div>

    </div>
  );
}
