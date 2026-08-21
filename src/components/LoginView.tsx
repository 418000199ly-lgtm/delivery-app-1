import React, { useState, useEffect, useRef } from 'react';
import { getBaseApiUrl } from '../lib/dbProxy';
import { HWDJ_LOGO_DATA_URL } from '../assets/hwdjLogoBase64';
import { 
  Smartphone, 
  ShieldCheck, 
  Loader2, 
  KeyRound, 
  MessageSquare, 
  AlertCircle,
  HelpCircle,
  X
} from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: (phoneNumber: string) => void;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  // --- SMS Login State ---
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [timer, setTimer] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  // Countdown timer handler for SMS backoff
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer(prev => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  // Candidate URLs helper for multi-environment robustness (Web / Capacitor Android APK / iOS / Cloud)
  const getCandidateApiUrls = (endpoint: string) => {
    const base = getBaseApiUrl();
    const urls: string[] = [];
    if (base) {
      urls.push(`${base}${endpoint}`);
    }
    urls.push(`https://api.lyheiwandaijiamax.com${endpoint}`);
    urls.push(`https://lyheiwandaijiamax.com${endpoint}`);
    urls.push(`https://admin.lyheiwandaijiamax.com${endpoint}`);
    if (typeof window !== 'undefined' && !window.location.hostname.includes('daijia')) {
      urls.push(endpoint);
    }
    return urls.filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
  };

  // Handle Send SMS Click via backend Express Proxy (Real Alibaba Cloud SMS)
  const handleGetSMSCode = async () => {
    const phoneTrimmed = phone.trim();
    if (!phoneTrimmed) {
      setErrorMsg('请输入您的手机号码');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phoneTrimmed)) {
      setErrorMsg('请输入正确的11位中国大陆手机号');
      return;
    }

    setErrorMsg('');
    setInfoMsg('');
    setIsSending(true);

    const postApi = async (endpoint: string, bodyObj: any) => {
      const candidateUrls = getCandidateApiUrls(endpoint);
      let lastError: any = null;
      for (const url of candidateUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok || res.status === 400 || res.status === 403 || res.status === 500) {
            return await res.json();
          }
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error('网络连接超时，请检查服务');
    };

    try {
      const data = await postApi('/api/sms/send', { phone: phoneTrimmed });
      setIsSending(false);

      if (data.success) {
        setTimer(60);
        setInfoMsg(data.message || '✓ 阿里云短信验证码已成功发送至您的手机，请注意查收短信！');
      } else {
        setErrorMsg(`❌ 验证码获取失败: ${data.error || '服务器响应异常'}`);
      }
    } catch (err: any) {
      console.error('[Login] Send SMS failed:', err);
      setIsSending(false);
      setErrorMsg(`❌ 验证码发送失败: ${err.message || '网络连接异常，请检查宝塔服务端接口连通性'}`);
    }
  };

  // Handle Login Submit via backend Express Proxy (Alibaba Cloud SMS Verification)
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    const phoneTrimmed = phone.trim();
    if (!phoneTrimmed || !/^1[3-9]\d{9}$/.test(phoneTrimmed)) {
      setErrorMsg('请输入正确的手机号码');
      return;
    }

    if (!smsCode) {
      setErrorMsg('请输入短信验证码');
      return;
    }

    setIsLoggingIn(true);

    const postApi = async (endpoint: string, bodyObj: any) => {
      const candidateUrls = getCandidateApiUrls(endpoint);
      let lastError: any = null;
      for (const url of candidateUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok || res.status === 400 || res.status === 403 || res.status === 500) {
            return await res.json();
          }
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error('网络连接超时，请检查服务');
    };

    try {
      const data = await postApi('/api/sms/verify', { phone: phoneTrimmed, code: smsCode.trim() });
      setIsLoggingIn(false);

      if (data.success) {
        // Enforce single active device session per phone number upon successful SMS verification
        const { registerDeviceSession } = await import('../utils/deviceSession');
        await registerDeviceSession(phoneTrimmed);
        onLoginSuccess(phoneTrimmed);
        return;
      } else {
        const rawError = data.error || '验证码校验未通过';
        if (rawError.includes('isv.ValidateFail') || rawError.includes('400') || rawError.includes('验证失败')) {
          setErrorMsg('❌ 验证失败，请正确填写接收到的短信验证码！');
        } else {
          setErrorMsg(`❌ 登录失败: ${rawError}`);
        }
      }
    } catch (err: any) {
      console.error('[Login] Verify network failed:', err);
      setIsLoggingIn(false);
      setErrorMsg(`❌ 校验登录失败: ${err.message || '网络连接超时'}`);
    }
  };

  return (
    <div className="w-full h-full bg-[#0a0b10] flex flex-col relative select-text overflow-hidden" id="login-module">
      
      {/* Mock Phone System Bar Spacer */}
      <div className="h-6 bg-black shrink-0"></div>

      {/* Brand Header */}
      <div className="px-6 pt-6 shrink-0 text-center">
        <h1 className="text-xl font-black text-slate-100 tracking-tight">黑湾代驾计费MAX</h1>
      </div>

      {/* Main Container Scrollbox */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col justify-between">
        
        <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in duration-300">
          
          {/* Brand Area with hwdjtb logo */}
          <div className="flex flex-col items-center justify-center pt-3 pb-1 shrink-0">
            <div className="w-28 h-28 rounded-2xl overflow-hidden shadow-2xl border border-slate-800/80 transition-all duration-300 hover:scale-105 bg-slate-900 flex items-center justify-center">
              <img 
                src={HWDJ_LOGO_DATA_URL} 
                alt="黑湾代驾" 
                className="w-full h-full object-cover rounded-2xl"
                loading="eager"
                decoding="sync"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.src.endsWith('hwdjtb.png')) {
                    target.src = './hwdjtb.png';
                  }
                }}
              />
            </div>
          </div>



          {/* Input fields form */}
          <form onSubmit={handleLoginSubmit} className="my-4 space-y-4 flex-1 flex flex-col justify-center">
            <div className="space-y-3.5">
              
              {/* Phone Number Field */}
              <div className="space-y-1.5 text-left">
                <label className="text-[9.5px] font-black tracking-wider text-slate-500 uppercase">
                  手机号码
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center space-x-1 border-r border-slate-800 pr-2">
                    <span className="text-[11px] font-black text-[#189F95]">+86</span>
                  </div>
                  <input
                    type="tel"
                    id="driver-auth-phone-field"
                    maxLength={11}
                    value={phone}
                    onChange={(e) => {
                      const cleanVal = e.target.value.replace(/\D/g, '');
                      setPhone(cleanVal);
                      setErrorMsg('');
                      setInfoMsg('');
                    }}
                    placeholder="请输入您的11位手机号码"
                    className="w-full pl-[56px] pr-4 py-3 bg-[#0e1017] border border-slate-900 rounded-2xl text-xs font-black focus:outline-hidden focus:border-[#189F95] text-slate-200 placeholder:text-slate-600 font-mono tracking-wider"
                  />
                </div>
              </div>

              {/* Verification Code Field */}
              <div className="space-y-1.5 text-left">
                <label className="text-[9.5px] font-black tracking-wider text-slate-500 uppercase">
                  短信验证码
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input
                      type="text"
                      id="driver-sms-code-input"
                      maxLength={6}
                      value={smsCode}
                      onChange={(e) => {
                        setSmsCode(e.target.value.trim());
                        setErrorMsg('');
                        setInfoMsg('');
                      }}
                      placeholder="请输入验证码"
                      className="w-full pl-10 pr-4 py-3 bg-[#0e1017] border border-slate-900 rounded-2xl text-xs font-black focus:outline-hidden focus:border-[#189F95] text-slate-200 placeholder:text-slate-600 font-mono tracking-widest text-center"
                    />
                  </div>
                  
                  {/* Send button with countdown */}
                  <button
                    type="button"
                    id="sms-sender-trigger-btn"
                    onClick={handleGetSMSCode}
                    disabled={timer > 0 || isSending}
                    className="px-3.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-[#189F95] hover:text-[#22bcae] rounded-2xl text-xs font-black transition-colors min-w-[96px] shrink-0 border border-slate-800 flex items-center justify-center cursor-pointer"
                  >
                    {isSending ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#189F95]" />
                    ) : timer > 0 ? (
                      `${timer}s`
                    ) : (
                      '获取验证码'
                    )}
                  </button>
                </div>
              </div>

            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-left text-[10px] text-rose-400 font-medium leading-relaxed">
                {errorMsg}
              </div>
            )}

            {/* Info Message */}
            {infoMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-left text-[10px] text-emerald-400 font-medium leading-relaxed">
                {infoMsg}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3.5 bg-[#189F95] hover:bg-[#20b3a8] disabled:opacity-50 active:scale-[0.98] text-slate-950 font-black text-xs rounded-2xl shadow-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer mt-2 text-center"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>正在验证并登录中...</span>
                </>
              ) : (
                <>
                  <span>立即安全登录进入系统 ➔</span>
                </>
              )}
            </button>

            {/* reCAPTCHA Hidden target container required by Firebase Phone Auth */}
            <div id="recaptcha-wrapper" className="hidden">
              <div id="recaptcha-container"></div>
            </div>

          </form>

        </div>

        {/* Footer info tip */}
        <div className="shrink-0 flex items-center justify-center gap-1 text-[9px] text-slate-500 pt-3 border-t border-slate-950">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>黑湾代驾计费MAX为您服务</span>
        </div>

      </div>

    </div>
  );
}
