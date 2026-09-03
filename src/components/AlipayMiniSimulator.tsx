import React, { useState, useEffect } from 'react';
import { db, doc, setDoc, getDoc } from '../lib/dbProxy';
import { 
  ShieldCheck, 
  Smartphone, 
  CheckCircle, 
  Copy, 
  Check, 
  FileCode, 
  ArrowRight, 
  Zap, 
  Sparkles, 
  Lock, 
  CreditCard, 
  RefreshCw, 
  ExternalLink,
  QrCode,
  Shield,
  Clock,
  ChevronRight,
  AlertCircle
} from 'lucide-react';

interface AlipayMiniSimulatorProps {
  currentDriverPhone?: string;
  onTriggerToast?: (msg: string) => void;
}

export const AlipayMiniSimulator: React.FC<AlipayMiniSimulatorProps> = ({
  currentDriverPhone = '15509601222',
  onTriggerToast
}) => {
  const [phone, setPhone] = useState(currentDriverPhone || '15509601222');
  const [selectedDays, setSelectedDays] = useState<number>(30);
  const [selectedPrice, setSelectedPrice] = useState<number>(9.9);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [payStep, setPayStep] = useState<'idle' | 'fingerprint' | 'processing' | 'success'>('idle');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'guide'>('preview');
  const [vipsRemainingDays, setVipsRemainingDays] = useState<number>(0);
  const [vipExpiryDate, setVipExpiryDate] = useState<string>('');

  useEffect(() => {
    if (currentDriverPhone) {
      setPhone(currentDriverPhone);
    }
  }, [currentDriverPhone]);

  // Load current VIP expiry for the driver
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dd_squad_members_v2');
      if (saved) {
        const list = JSON.parse(saved);
        const match = list.find((m: any) => m.phone === phone || m.id === phone);
        if (match && match.vipExpiryDate) {
          setVipExpiryDate(match.vipExpiryDate);
          const exp = new Date(match.vipExpiryDate).getTime();
          const now = Date.now();
          if (exp > now) {
            const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
            setVipsRemainingDays(daysLeft);
          } else {
            setVipsRemainingDays(0);
          }
        }
      }
    } catch (e) {}
  }, [phone, payStep]);

  const alipaySchemeUrl = `alipays://platformapi/startapp?appId=2026998811002233&page=pages/pay/index&query=${encodeURIComponent(`phone=${phone}&days=${selectedDays}&amount=${selectedPrice}`)}`;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    if (onTriggerToast) onTriggerToast('复制成功');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleStartPayment = () => {
    setIsPayModalOpen(true);
    setPayStep('fingerprint');
  };

  const handleConfirmPay = () => {
    setPayStep('processing');
    setTimeout(() => {
      // Execute simulated payment & automatically add 30 days VIP
      const now = new Date();
      let newExpiry = new Date();
      if (vipExpiryDate && new Date(vipExpiryDate).getTime() > now.getTime()) {
        newExpiry = new Date(new Date(vipExpiryDate).getTime() + selectedDays * 24 * 60 * 60 * 1000);
      } else {
        newExpiry = new Date(now.getTime() + selectedDays * 24 * 60 * 60 * 1000);
      }
      const expiryStr = newExpiry.toISOString().replace('T', ' ').substring(0, 19);

      // Update localStorage dd_squad_members_v2
      try {
        const saved = localStorage.getItem('dd_squad_members_v2');
        let list = saved ? JSON.parse(saved) : [];
        if (!Array.isArray(list)) list = [];
        let found = false;
        list = list.map((m: any) => {
          if (m.phone === phone || m.id === phone) {
            found = true;
            return {
              ...m,
              isVip: true,
              vipStatus: '已开通VIP',
              vipExpiryDate: expiryStr,
              lastRenewAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
            };
          }
          return m;
        });
        if (!found) {
          list.push({
            id: phone,
            phone: phone,
            name: `司机${phone.slice(-4)}`,
            isVip: true,
            vipStatus: '已开通VIP',
            vipExpiryDate: expiryStr,
            role: '队员',
            status: '已通过'
          });
        }
        localStorage.setItem('dd_squad_members_v2', JSON.stringify(list));
      } catch (e) {}

      // Update db Proxy if available
      if (db) {
        setDoc(doc(db, 'squad_members', phone), {
          isVip: true,
          vipStatus: '已开通VIP',
          vipExpiryDate: expiryStr,
          lastRenewAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
        }, { merge: true }).catch(() => {});
      }

      setVipExpiryDate(expiryStr);
      setVipsRemainingDays(prev => prev + selectedDays);
      setPayStep('success');

      if (onTriggerToast) {
        onTriggerToast(`🎉 支付宝付款成功！已为 ${phone} 成功续费 ${selectedDays} 天VIP会员！`);
      }
    }, 1200);
  };

  const miniProgramJsCode = `// 支付宝小程序页面 pages/pay/index.js
Page({
  data: {
    phone: '',
    amount: '9.90',
    days: 30,
    loading: false,
    paySuccess: false
  },

  onLoad(query) {
    if (query && query.phone) {
      this.setData({
        phone: query.phone,
        amount: query.amount || '9.90',
        days: query.days || 30
      });
      // 页面加载完成后，自动触发支付宝原生收银台
      this.autoInvokePay(query.phone, query.amount);
    }
  },

  autoInvokePay(phone, amount) {
    const that = this;
    that.setData({ loading: true });

    // 1. 请求宝塔/云服务器后端获取支付宝预支付交易号 (tradeNO)
    my.request({
      url: 'https://your-domain.com/api/vip/create-alipay-trade',
      method: 'POST',
      data: { phone: phone, amount: amount },
      success: (res) => {
        if (res.data && res.data.tradeNo) {
          // 2. 调用支付宝原生收银台接口 my.tradePay
          my.tradePay({
            tradeNO: res.data.tradeNo,
            success: (result) => {
              if (result.resultCode === '9000') {
                // 9000 标识订单支付成功
                that.setData({ paySuccess: true, loading: false });
                my.showToast({
                  type: 'success',
                  content: '充值成功！自动生效',
                  duration: 2000
                });
              } else {
                that.setData({ loading: false });
                my.showToast({ type: 'fail', content: '支付取消或未完成' });
              }
            },
            fail: () => {
              that.setData({ loading: false });
            }
          });
        }
      }
    });
  },

  // 快捷返回 H5 代驾系统
  handleReturnToH5() {
    my.navigateBack({ delta: 1 });
  }
});`;

  const backendApiCode = `// 宝塔服务器 Node.js/Express 支付宝支付与回调接口 (/server.ts)
import AlipaySdk from 'alipay-sdk';

const alipaySdk = new AlipaySdk({
  appId: process.env.ALIPAY_APP_ID,
  privateKey: process.env.ALIPAY_PRIVATE_KEY,
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
});

// 1. 生成支付宝小程序预支付交易号
app.post('/api/vip/create-alipay-trade', async (req, res) => {
  const { phone, amount } = req.body;
  const outTradeNo = 'VIP_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

  try {
    const result = await alipaySdk.exec('alipay.trade.create', {
      bizContent: {
        out_trade_no: outTradeNo,
        total_amount: amount,
        subject: '黑湾代驾系统 - 司机VIP 30天订阅',
        buyer_id: req.body.buyerId || '', 
      }
    });
    res.json({ success: true, tradeNo: result.tradeNo, outTradeNo });
  } catch (err) {
    res.status(500).json({ error: '创建交易失败', message: err.message });
  }
});

// 2. 支付宝异步回调通知接口 (alipay-notify)
app.post('/api/pay/alipay-notify', async (req, res) => {
  const params = req.body;
  // 校验支付宝异步通知签名
  const isValid = alipaySdk.checkNotifySign(params);
  if (isValid && params.trade_status === 'TRADE_SUCCESS') {
    const phone = params.passback_params; // 附加参数中的手机号
    // 自动为该手机号延长 30 天 VIP
    await updateUserVipDays(phone, 30);
    res.send('success'); // 必须返回字符串 success
  } else {
    res.send('fail');
  }
});`;

  return (
    <div className="w-full h-full flex flex-col bg-[#0b1329] text-slate-100 overflow-hidden font-sans">
      {/* Header bar */}
      <div className="bg-[#101c38] border-b border-[#1e2e56] px-5 py-3.5 flex items-center justify-between shrink-0 shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#1677FF] to-[#0052D9] flex items-center justify-center text-white font-bold shadow-md shadow-[#1677FF]/30">
            <span className="text-lg">支</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              支付宝小程序【极简中转收银台】
              <span className="bg-[#1677FF]/20 text-[#4096ff] text-[11px] font-semibold px-2 py-0.5 rounded-full border border-[#1677FF]/30">
                方案一：高稳定性·合规直付
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              司机在网页点“购买” ➔ 跳转支付宝小程序调起指纹支付 ➔ 服务器异步回调加 VIP 30 天
            </p>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center bg-[#091024] p-1 rounded-xl border border-[#1c2c54]">
          <button
            onClick={() => setActiveTab('preview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'preview'
                ? 'bg-[#1677FF] text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>小程序效果模拟 preview</span>
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'code'
                ? 'bg-[#1677FF] text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>前后端完整代码源码</span>
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'guide'
                ? 'bg-[#1677FF] text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>支付宝开放平台配置教程</span>
          </button>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {activeTab === 'preview' && (
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Col: Smartphone Mockup (Alipay Mini Program Interface) */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="text-xs font-semibold text-slate-400 mb-2.5 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-[#1677FF] animate-ping" />
                <span>支付宝小程序界面展示 (`pages/pay/index`)</span>
              </div>

              {/* Mobile Device Frame */}
              <div className="w-[360px] h-[720px] bg-[#f5f6f9] rounded-[42px] border-[8px] border-[#1a233b] shadow-[0_25px_60px_-15px_rgba(22,119,255,0.25)] flex flex-col overflow-hidden relative text-slate-800">
                
                {/* Alipay Title Header Bar */}
                <div className="bg-[#1677FF] text-white pt-3 pb-3 px-4 flex items-center justify-between shrink-0 select-none">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold tracking-tight">10:42</span>
                    <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded">5G</span>
                  </div>
                  <span className="text-sm font-bold tracking-wide">官方服务收银台</span>
                  {/* Alipay Capsule Button Style */}
                  <div className="flex items-center bg-black/20 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/20 space-x-2 text-white">
                    <span className="text-[10px] font-mono">•••</span>
                    <span className="w-3 h-3 rounded-full border-2 border-white flex items-center justify-center text-[8px]">☉</span>
                  </div>
                </div>

                {/* Main Scrollable Mini Program Canvas */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">

                  {/* Merchant Brand Card */}
                  <div className="bg-gradient-to-br from-[#1677FF] to-[#0052D9] rounded-2xl p-4 text-white shadow-md relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 opacity-15 text-white">
                      <ShieldCheck className="w-28 h-28" />
                    </div>
                    <div className="flex items-center space-x-2.5 mb-2">
                      <div className="w-8 h-8 rounded-full bg-white text-[#1677FF] font-black flex items-center justify-center text-sm shadow">
                        黑
                      </div>
                      <div>
                        <h3 className="font-bold text-sm leading-tight">黑湾代叫官方服务平台</h3>
                        <p className="text-[10px] opacity-80">支付宝小程序官方认证通道 · 资金防伪托管</p>
                      </div>
                    </div>
                    <div className="mt-3 bg-white/10 backdrop-blur-sm rounded-xl p-2.5 border border-white/15 text-xs flex justify-between items-center">
                      <span className="opacity-90">当前充值手机号</span>
                      <span className="font-mono font-bold tracking-wider">{phone}</span>
                    </div>
                  </div>

                  {/* VIP Plan Details Box */}
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 space-y-3">
                    <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400" />
                          <h4 className="font-bold text-slate-800 text-sm">司机端 30天全能VIP会员</h4>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">无缝开通 · 免拦截 · 支持全车队抢单</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-400 line-through mr-1">¥15.00</span>
                        <span className="text-lg font-black text-[#1677FF]">¥{selectedPrice.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs text-slate-600">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">会员权益周期</span>
                        <span className="font-semibold text-slate-800">30 天 (按自然日累加)</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">目前剩余 VIP 天数</span>
                        <span className="font-semibold text-amber-600 font-mono">{vipsRemainingDays} 天</span>
                      </div>
                      {vipExpiryDate && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">到期时间</span>
                          <span className="font-mono text-[11px] text-slate-700">{vipExpiryDate}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">支付通道类型</span>
                        <span className="text-emerald-600 font-medium flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          支付宝官方 `my.tradePay`
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Payment Selection Packages */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-600 block px-1">选择充值套餐</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => { setSelectedDays(30); setSelectedPrice(9.9); }}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          selectedDays === 30
                            ? 'border-[#1677FF] bg-[#1677FF]/5 text-[#1677FF] font-bold shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold">30 天月卡</div>
                        <div className="text-base font-black text-[#1677FF] mt-1">¥ 9.90</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">低至 0.3 元/天</div>
                      </button>

                      <button
                        onClick={() => { setSelectedDays(90); setSelectedPrice(26.8); }}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          selectedDays === 90
                            ? 'border-[#1677FF] bg-[#1677FF]/5 text-[#1677FF] font-bold shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold">90 天季卡 (推荐)</div>
                        <div className="text-base font-black text-[#1677FF] mt-1">¥ 26.80</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">立省 3 元</div>
                      </button>
                    </div>
                  </div>

                  {/* Interactive Trigger Button */}
                  <div className="pt-2">
                    <button
                      onClick={handleStartPayment}
                      className="w-full bg-gradient-to-r from-[#1677FF] to-[#0052D9] hover:from-[#1565C0] hover:to-[#0D47A1] text-white py-3.5 px-4 rounded-xl font-bold text-sm shadow-lg shadow-[#1677FF]/30 active:scale-98 transition-all flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>唤起支付宝极速支付 ¥{selectedPrice.toFixed(2)}</span>
                    </button>
                    <p className="text-[10px] text-slate-400 text-center mt-2 flex items-center justify-center space-x-1">
                      <Lock className="w-3 h-3 text-emerald-500" />
                      <span>支付成功后，系统将自动触发回调并更新您的VIP权限</span>
                    </p>
                  </div>

                  {/* Static Required Compliance Elements for Alipay Audit */}
                  <div className="bg-slate-100/80 rounded-xl p-3 border border-slate-200 text-[10px] text-slate-500 space-y-1.5 mt-4">
                    <div className="font-bold text-slate-700">平台合规备案与备案提示：</div>
                    <p>1. 本小程序为【黑湾代叫系统】官方在线支付通道，不收取任何未明示费用。</p>
                    <p>2. 付款完成即刻生效，若支付中遇到任何问题，可随时联系系统管理员。</p>
                    <div className="pt-1 border-t border-slate-200 flex justify-between text-slate-400">
                      <span>《用户服务协议》</span>
                      <span>《隐私保护指引》</span>
                    </div>
                  </div>

                </div>

                {/* Simulated Alipay Cashier Modal Sheet */}
                {isPayModalOpen && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs z-50 flex flex-col justify-end animate-in fade-in duration-200">
                    <div className="bg-white rounded-t-3xl p-5 space-y-4 animate-in slide-in-from-bottom duration-300 shadow-2xl">
                      
                      {/* Cashier Header */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center space-x-2">
                          <span className="w-6 h-6 rounded-full bg-[#1677FF] text-white text-xs font-bold flex items-center justify-center">支</span>
                          <span className="font-bold text-slate-800 text-sm">支付宝快捷收银台</span>
                        </div>
                        <button 
                          onClick={() => setIsPayModalOpen(false)}
                          className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>

                      {payStep === 'fingerprint' && (
                        <div className="space-y-4 text-center py-2">
                          <div className="text-2xl font-black text-slate-900 font-mono">
                            ¥ {selectedPrice.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-500">
                            商户名称：黑湾代叫官方服务平台
                          </div>

                          <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 flex justify-between items-center border border-slate-100">
                            <span>付款方式</span>
                            <span className="font-medium text-slate-800 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                              支付宝余额 / 花呗 (首选)
                            </span>
                          </div>

                          <div className="py-3 flex flex-col items-center justify-center space-y-2">
                            <div className="w-14 h-14 rounded-full bg-[#1677FF]/10 text-[#1677FF] flex items-center justify-center animate-pulse">
                              <Lock className="w-7 h-7" />
                            </div>
                            <span className="text-xs font-semibold text-slate-700">请验证指纹或面容完成付款</span>
                          </div>

                          <button
                            onClick={handleConfirmPay}
                            className="w-full bg-[#1677FF] hover:bg-[#1565C0] text-white py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer"
                          >
                            验证指纹 / 输入密码扣款
                          </button>
                        </div>
                      )}

                      {payStep === 'processing' && (
                        <div className="py-8 flex flex-col items-center justify-center space-y-3">
                          <RefreshCw className="w-10 h-10 text-[#1677FF] animate-spin" />
                          <span className="text-sm font-bold text-slate-700">正在通讯支付宝服务器...</span>
                          <span className="text-xs text-slate-400">正在生成加密数据包与回调凭证</span>
                        </div>
                      )}

                      {payStep === 'success' && (
                        <div className="py-4 text-center space-y-4">
                          <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                            <CheckCircle className="w-8 h-8 fill-current" />
                          </div>
                          <div>
                            <h4 className="text-base font-bold text-slate-900">支付成功！VIP会员已激活</h4>
                            <p className="text-xs text-slate-500 mt-1">
                              已成功为手机号 <span className="font-mono text-slate-800 font-bold">{phone}</span> 增加 {selectedDays} 天 VIP
                            </p>
                          </div>
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 font-mono text-left">
                            <div>• 订单号: VIP_{Date.now().toString().slice(-8)}</div>
                            <div>• 新到期时间: {vipExpiryDate}</div>
                            <div>• 拦截状态: 已解除全部拦截限制</div>
                          </div>
                          <button
                            onClick={() => {
                              setIsPayModalOpen(false);
                              setPayStep('idle');
                            }}
                            className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-xl font-bold text-sm transition-all cursor-pointer"
                          >
                            完成并返回代驾系统
                          </button>
                        </div>
                      )}

                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Right Col: Scheme Tester & Interactive Instructions */}
            <div className="lg:col-span-7 space-y-5">
              
              {/* Box 1: Dynamic URL Scheme Generator */}
              <div className="bg-[#101c38] border border-[#1e2e56] rounded-2xl p-5 shadow-md space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Zap className="w-5 h-5 text-[#4096ff]" />
                    <h3 className="font-bold text-sm text-white">H5 唤起支付宝小程序的 URL Scheme</h3>
                  </div>
                  <span className="bg-emerald-500/20 text-emerald-300 text-[11px] font-mono px-2 py-0.5 rounded border border-emerald-500/30">
                    格式符合支付宝官方标准
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  网页前端（司机端）只需通过以下 Scheme 链接，即可在 iOS/Android 手机上一键唤起支付宝 APP 并自动定位到充值页面：
                </p>

                <div className="bg-[#070d1a] p-3 rounded-xl border border-[#1b2a4e] font-mono text-xs text-sky-300 break-all select-all flex items-start justify-between gap-3">
                  <span>{alipaySchemeUrl}</span>
                  <button
                    onClick={() => handleCopy(alipaySchemeUrl, 'scheme')}
                    className="shrink-0 bg-[#1677FF] hover:bg-[#1565C0] text-white px-2.5 py-1 rounded-lg text-xs font-sans font-bold flex items-center space-x-1 cursor-pointer"
                  >
                    {copiedCode === 'scheme' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode === 'scheme' ? '已复制' : '复制 Scheme'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="bg-[#0c162d] p-3 rounded-xl border border-[#182747] text-xs">
                    <span className="text-slate-400 block text-[11px] mb-1">测试手机号 (userPhone)</span>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-[#142244] border border-[#243763] rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-[#1677FF]"
                    />
                  </div>
                  <div className="bg-[#0c162d] p-3 rounded-xl border border-[#182747] text-xs">
                    <span className="text-slate-400 block text-[11px] mb-1">VIP 充值增加天数</span>
                    <select
                      value={selectedDays}
                      onChange={(e) => {
                        const d = Number(e.target.value);
                        setSelectedDays(d);
                        setSelectedPrice(d === 30 ? 9.9 : 26.8);
                      }}
                      className="w-full bg-[#142244] border border-[#243763] rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-[#1677FF]"
                    >
                      <option value={30}>30 天 (9.9元)</option>
                      <option value={90}>90 天 (26.8元)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Box 2: Core Advantages Summary */}
              <div className="bg-[#101c38] border border-[#1e2e56] rounded-2xl p-5 shadow-md space-y-4">
                <h3 className="font-bold text-sm text-white flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span>支付宝小程序中转支付三大核心优势</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-[#0c162d] p-3.5 rounded-xl border border-[#182747] space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-[#1677FF]/20 text-[#4096ff] flex items-center justify-center font-bold text-xs">
                      1
                    </div>
                    <div className="font-bold text-xs text-slate-100">极度稳定·抗封禁</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      不依赖易受封禁的独立 H5 网页支付，全程走官方小程序合规通道。
                    </p>
                  </div>

                  <div className="bg-[#0c162d] p-3.5 rounded-xl border border-[#182747] space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold text-xs">
                      2
                    </div>
                    <div className="font-bold text-xs text-slate-100">全自动零人工</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      付款成功后，支付宝服务器发送回调，秒级自动更新账号 VIP 权限。
                    </p>
                  </div>

                  <div className="bg-[#0c162d] p-3.5 rounded-xl border border-[#182747] space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center font-bold text-xs">
                      3
                    </div>
                    <div className="font-bold text-xs text-slate-100">指纹面容无缝支付</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      司机一键唤起手机支付宝指纹弹窗，体验流畅，转化率极高。
                    </p>
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

        {activeTab === 'code' && (
          <div className="max-w-5xl mx-auto space-y-6">
            
            {/* Front-end Alipay Mini Program Code */}
            <div className="bg-[#101c38] border border-[#1e2e56] rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileCode className="w-5 h-5 text-[#4096ff]" />
                  <h3 className="font-bold text-sm text-white">1. 支付宝小程序前端代码 (`pages/pay/index.js`)</h3>
                </div>
                <button
                  onClick={() => handleCopy(miniProgramJsCode, 'jsCode')}
                  className="bg-[#1677FF] hover:bg-[#1565C0] text-white px-3 py-1 rounded-lg text-xs font-bold flex items-center space-x-1 cursor-pointer"
                >
                  {copiedCode === 'jsCode' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode === 'jsCode' ? '已复制' : '复制小程序代码'}</span>
                </button>
              </div>
              <pre className="bg-[#070d1a] p-4 rounded-xl border border-[#1b2a4e] font-mono text-xs text-sky-200 overflow-x-auto">
                {miniProgramJsCode}
              </pre>
            </div>

            {/* Back-end Baota Node.js Code */}
            <div className="bg-[#101c38] border border-[#1e2e56] rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileCode className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-bold text-sm text-white">2. 宝塔服务器 Node.js 支付宝异步回调接口 (`server.ts`)</h3>
                </div>
                <button
                  onClick={() => handleCopy(backendApiCode, 'apiCode')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-lg text-xs font-bold flex items-center space-x-1 cursor-pointer"
                >
                  {copiedCode === 'apiCode' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode === 'apiCode' ? '已复制' : '复制后端代码'}</span>
                </button>
              </div>
              <pre className="bg-[#070d1a] p-4 rounded-xl border border-[#1b2a4e] font-mono text-xs text-emerald-200 overflow-x-auto">
                {backendApiCode}
              </pre>
            </div>

          </div>
        )}

        {activeTab === 'guide' && (
          <div className="max-w-4xl mx-auto bg-[#101c38] border border-[#1e2e56] rounded-2xl p-6 space-y-5">
            <div className="flex items-center space-x-3 border-b border-[#1e2e56] pb-4">
              <div className="w-10 h-10 rounded-xl bg-[#1677FF] text-white font-black text-xl flex items-center justify-center">
                支
              </div>
              <div>
                <h3 className="font-bold text-base text-white">支付宝开放平台配置与上线全流程指南</h3>
                <p className="text-xs text-slate-400">只需简单的 4 个步骤即可在开放平台开通并发布中转小程序</p>
              </div>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div className="bg-[#0c162d] p-4 rounded-xl border border-[#182747] space-y-2">
                <div className="font-bold text-sm text-[#4096ff] flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#1677FF] text-white flex items-center justify-center text-xs font-bold">1</span>
                  注册支付宝小程序 (open.alipay.com)
                </div>
                <p className="text-slate-400 pl-7 leading-relaxed">
                  使用支付宝账号登录开放平台，创建一个小程序应用。类型选择“工具”或“便民服务”即可（个体户或企业资质均可）。
                </p>
              </div>

              <div className="bg-[#0c162d] p-4 rounded-xl border border-[#182747] space-y-2">
                <div className="font-bold text-sm text-emerald-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">2</span>
                  开通“小程序支付”能力
                </div>
                <p className="text-slate-400 pl-7 leading-relaxed">
                  在小程序后台的能力列表中，勾选开通“小程序支付”或“当面付”能力。上传您的银行卡信息用于收款结算（实时结算至您的支付宝提现卡）。
                </p>
              </div>

              <div className="bg-[#0c162d] p-4 rounded-xl border border-[#182747] space-y-2">
                <div className="font-bold text-sm text-amber-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold">3</span>
                  在宝塔后台配置 RSA2 私钥与公钥
                </div>
                <p className="text-slate-400 pl-7 leading-relaxed">
                  在支付宝开发设置中，生成密钥对（应用私钥与支付宝公钥），将 `ALIPAY_APP_ID` 和 `ALIPAY_PRIVATE_KEY` 保存到宝塔服务器的 `.env` 环境变量中。
                </p>
              </div>

              <div className="bg-[#0c162d] p-4 rounded-xl border border-[#182747] space-y-2">
                <div className="font-bold text-sm text-purple-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">4</span>
                  发布上线与 Scheme 配置
                </div>
                <p className="text-slate-400 pl-7 leading-relaxed">
                  使用【支付宝开发者工具】一键上传上面的 `pages/pay/index` 代码并提交审核（通常 1~2 小时内自动审核通过）。审核通过后即可获得正式 Scheme 链接上线运行！
                </p>
              </div>
            </div>

          </div>
        )}
      </div>

    </div>
  );
};
export default AlipayMiniSimulator;
