import React, { useState, useEffect } from 'react';
import {
  Globe,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  Edit2,
  FileCheck2,
  User,
  ChevronRight,
  Camera,
  UploadCloud,
  MapPin
} from 'lucide-react';
import { ChauffeurSettings } from '../types';
import { db, doc, getDoc, onSnapshot, setDoc } from '../lib/dbProxy';
import { CITY_GROUPS, ALL_CITIES_FLAT } from '../constants/cities';
import { resolveAndSyncDuplicateNames } from '../utils/nameResolver';

interface OnlineOrderApplicationModalProps {
  userPhone: string;
  settings: ChauffeurSettings;
  onClose: () => void;
  onUpdateSettings?: (updated: ChauffeurSettings) => void;
}

export default function OnlineOrderApplicationModal({
  userPhone,
  settings,
  onClose,
  onUpdateSettings
}: OnlineOrderApplicationModalProps) {
  const [onlineApp, setOnlineApp] = useState<any>(null);
  const [loadingApp, setLoadingApp] = useState(false);
  const [localAlert, setLocalAlert] = useState<{ title: string; message: string; type?: 'warning' | 'info' | 'success' } | null>(null);

  // Form Fields
  const [applicantName, setApplicantName] = useState('');
  const [applicantGender, setApplicantGender] = useState('男');
  const [applicantAge, setApplicantAge] = useState('');
  const [applicantEmergencyPhone, setApplicantEmergencyPhone] = useState('');
  const [applicantDrivingYears, setApplicantDrivingYears] = useState('');
  const [applicantCity, setApplicantCity] = useState(settings?.city || '银川市');
  const [idCardFront, setIdCardFront] = useState('');
  const [idCardBack, setIdCardBack] = useState('');
  const [driverLicenseFront, setDriverLicenseFront] = useState('');
  const [driverLicenseBack, setDriverLicenseBack] = useState('');
  const [submittingApp, setSubmittingApp] = useState(false);

  // City Selector
  const [showCitySelector, setShowCitySelector] = useState(false);
  const [searchCityQuery, setSearchCityQuery] = useState('');

  // Subscribe to `/online_applications/{userPhone}`
  useEffect(() => {
    if (!userPhone) return;
    setLoadingApp(true);
    const docRef = doc(db, 'online_applications', userPhone);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const appData = docSnap.data();
        setOnlineApp({ id: docSnap.id, ...appData });
        if (appData) {
          setApplicantName(appData.driverName || '');
          setApplicantGender(appData.driverGender || '男');
          setApplicantAge(String(appData.driverAge || ''));
          setApplicantEmergencyPhone(appData.emergencyPhone || '');
          setApplicantDrivingYears(String(appData.drivingYears || ''));
          setApplicantCity(appData.city || settings?.city || '银川市');
          setIdCardFront(appData.idCardFront || '');
          setIdCardBack(appData.idCardBack || '');
          setDriverLicenseFront(appData.driverLicenseFront || '');
          setDriverLicenseBack(appData.driverLicenseBack || '');
        }
      } else {
        setOnlineApp(null);
        setApplicantName('');
        setApplicantGender('男');
        setApplicantAge('');
        setApplicantEmergencyPhone('');
        setApplicantDrivingYears('');
        setApplicantCity(settings?.city || '银川市');
        setIdCardFront('');
        setIdCardBack('');
        setDriverLicenseFront('');
        setDriverLicenseBack('');
      }
      setLoadingApp(false);
    }, (err) => {
      console.error("Error listening to online applications:", err);
      setLoadingApp(false);
    });
    return () => unsubscribe();
  }, [userPhone, settings?.city]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter(reader.result as string);
    };
    reader.onerror = (err) => {
      console.error("FileReader error:", err);
      alert("⚠️ 读取图片失败，请重试！");
    };
    reader.readAsDataURL(file);
  };

  const handleOnlineAppSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPhone) {
      alert("⚠️ 错误：未获取到当前司机手机号，请刷新页面！");
      return;
    }

    const name = applicantName.trim();
    const gender = applicantGender;
    const age = parseInt(applicantAge);
    const emgPhone = applicantEmergencyPhone.trim();
    const dYears = parseInt(applicantDrivingYears);
    const city = applicantCity.trim();

    if (!name || isNaN(age) || isNaN(dYears) || !emgPhone || !city || !idCardFront || !idCardBack || !driverLicenseFront || !driverLicenseBack) {
      alert("⚠️ 提交失败：请完整填写履历表单、选择开通城市并准备好全部实名证照影像！");
      return;
    }
    
    if (!/^1[3-9]\d{9}$/.test(emgPhone)) {
      alert("⚠️ 请输入有效的11位紧急联系人手机号！");
      return;
    }
    
    setSubmittingApp(true);
    try {
      await setDoc(doc(db, 'online_applications', userPhone), {
        driverPhone: userPhone,
        driverName: name,
        driverGender: gender,
        driverAge: age,
        emergencyPhone: emgPhone,
        drivingYears: dYears,
        city,
        idCardFront,
        idCardBack,
        driverLicenseFront,
        driverLicenseBack,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Run real-time naming conflict suffix resolution
      await resolveAndSyncDuplicateNames();

      alert("🎉 申请提交成功！各项资料已实时安全同步至决策大盘运营管理后台，等待管理员审批核对，可在后台「审批功能」页查看其处理状态。");
    } catch (err: any) {
      console.error("Error submitting driver application:", err);
      alert("提交失败：" + err.message);
    } finally {
      setSubmittingApp(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-slate-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
      {/* Page Toolbar Header */}
      <div className="bg-slate-900 text-white header-safe-pt pb-3 px-4 flex items-center justify-between shrink-0 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20 text-teal-400">
            <Globe className="w-4 h-4" />
          </div>
          <div className="text-left">
            <h3 className="font-extrabold text-xs text-white">线上听单资质认证</h3>
            <span className="text-[9px] text-slate-400 font-normal">当前城市线上订单开通申请</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-90 cursor-pointer"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Page Main Content area with relative scrolling */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(2rem+max(env(safe-area-inset-bottom,0px),28px))] space-y-4 android-nav-safe-pb">
        {loadingApp ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-[11px] font-black text-slate-500 animate-pulse">正在获取账号实时的同步审批状态...</p>
          </div>
        ) : onlineApp && onlineApp.status !== 're-filling' ? (
          /* IF AN APPLICATION RECORD ALREADY EXISTS */
          <div className="space-y-4">
            {/* 1. Status block */}
            {onlineApp.status === 'pending' && (
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex flex-col items-center text-center space-y-2">
                <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 animate-bounce">
                  <Clock className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-black text-amber-800">审核中 (等待管理员审批)</h4>
                <p className="text-[11px] text-amber-700 leading-relaxed font-bold font-sans max-w-[280px]">
                  您的线上高级听单资质资料已同步至云端审计中心，系统当前正在进行资质比对或管理员审核。预计2小时内完成，请耐心等待！
                </p>
              </div>
            )}

            {onlineApp.status === 'approved' && (
              <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-150 flex flex-col items-center text-center space-y-2">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 animate-pulse">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-black text-emerald-800">✅ 审核已通过 (享有线上派单资格)</h4>
                <p className="text-[11px] text-emerald-700 leading-relaxed font-semibold font-sans max-w-[280px]">
                  恭喜您！您的线上代驾单业务已成功激活开通！您已加入平台的智能派单调度策略序列中。
                </p>

                {/* Integrated status message indicating automatic activation by admin */}
                <div className="w-full bg-white rounded-xl p-3 border border-emerald-100 mt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div className="text-left">
                    <span className="text-[11px] font-black text-slate-800 block">自动线上听单</span>
                    <span className="text-[9.5px] text-emerald-600 block leading-normal mt-0.5">管理后台审批通过后，系统已为您自动激活开启线上听单功能。您当前已加入平台智能调度派单队列。</span>
                  </div>
                  <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md shrink-0">
                    已自动开启
                  </span>
                </div>
              </div>
            )}

            {onlineApp.status === 'rejected' && (
              <div className="bg-red-50 rounded-2xl p-4 border border-red-150 flex flex-col items-center text-center space-y-2">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-black text-red-800">❌ 审核未通过 (申请已被驳回)</h4>
                
                <div className="w-full bg-white/90 border border-red-200/50 rounded-xl p-3 text-left">
                  <span className="text-[10px] font-black text-red-600 block mb-1">駁回原因 / 改进建议：</span>
                  <p className="text-[11px] text-red-800 leading-relaxed font-bold">
                    {onlineApp.rejectionReason || '原因：您提交的某一证件正面反射光太强、人像面部模糊或驾龄信息有误，无法认定资质。'}
                  </p>
                </div>

                <p className="text-[10px] text-slate-500 leading-relaxed max-w-[280px]">
                  您可以对填写的表单内容再次修正，并点击下方按钮重新发起认证审核，我们会加急为您流转。
                </p>

                <button
                  type="button"
                  onClick={async () => {
                    if (confirm("确定要重新填写申请吗？这会清除您上一次提交的信息状态。")) {
                      try {
                        setLoadingApp(true);
                        // Clear application
                        const appDocRef = doc(db, 'online_applications', userPhone || '');
                        await setDoc(appDocRef, {
                          ...onlineApp,
                          status: 're-filling',
                          updatedAt: new Date().toISOString()
                        });
                        setOnlineApp(null);
                      } catch(err: any) {
                        alert("重置申请出错：" + err.message);
                      } finally {
                        setLoadingApp(false);
                      }
                    }
                  }}
                  className="w-full h-10 mt-2 rounded-xl bg-slate-900 border border-slate-950 font-extrabold text-xs text-white hover:bg-slate-800 transition-all flex items-center justify-center space-x-1 active:scale-97 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>更新资料并重新申请</span>
                </button>
              </div>
            )}

            {/* 2. Filed Info Details Summary Card */}
            <div className="bg-white rounded-2xl p-3.5 border border-slate-200 space-y-3">
              <div className="flex items-center space-x-1.5 border-b border-slate-100 pb-2">
                <FileCheck2 className="w-4 h-4 text-slate-800" />
                <span className="text-xs font-black text-slate-900">已提交审核的申报案详情</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-left">
                <div className="bg-slate-50 p-2 rounded-lg">
                  <span className="text-slate-500 block text-[9px]">司机手机号</span>
                  <span className="font-extrabold text-slate-800 font-mono">{onlineApp.driverPhone}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg">
                  <span className="text-slate-500 block text-[9px]">司机姓名</span>
                  <span className="font-extrabold text-slate-800">{onlineApp.driverName}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg">
                  <span className="text-slate-500 block text-[9px]">司机年龄 / 性别</span>
                  <span className="font-extrabold text-slate-800">{onlineApp.driverAge}岁 / {onlineApp.driverGender}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg">
                  <span className="text-slate-500 block text-[9px]">驾龄 (年)</span>
                  <span className="font-extrabold text-slate-800">{onlineApp.drivingYears} 年</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg col-span-2">
                  <span className="text-slate-500 block text-[9px]">紧急联系人手机号</span>
                  <span className="font-extrabold text-slate-800 font-mono">{onlineApp.emergencyPhone}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg col-span-2 flex justify-between items-center">
                  <div>
                    <span className="text-slate-500 block text-[9px]">线上单开通城市</span>
                    <span className="font-extrabold text-teal-600">📍 {onlineApp.city || '暂无城市信息'}</span>
                  </div>
                  <span className="text-[8.5px] bg-slate-200 text-slate-500 font-bold px-1.5 py-0.5 rounded">不可自主修改</span>
                </div>
              </div>

              {/* 4 Photo slots thumbnail preview */}
              <div className="space-y-1.5 pt-1 text-left">
                <span className="text-[10px] font-black text-slate-500 block">证件影像档案 (4份已提交)</span>
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                    <img src={onlineApp.idCardFront} className="w-full h-11 object-cover rounded-md" alt="身份证正" referrerPolicy="no-referrer" />
                    <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">身份证正</span>
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                    <img src={onlineApp.idCardBack} className="w-full h-11 object-cover rounded-md" alt="身份证反" referrerPolicy="no-referrer" />
                    <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">身份证反</span>
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                    <img src={onlineApp.driverLicenseFront} className="w-full h-11 object-cover rounded-md" alt="驾驶证" referrerPolicy="no-referrer" />
                    <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">驾驶证正</span>
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                    <img src={onlineApp.driverLicenseBack} className="w-full h-11 object-cover rounded-md" alt="驾驶证副" referrerPolicy="no-referrer" />
                    <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">驾驶证副</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-amber-50/50 border border-amber-200/40 rounded-xl text-left">
              <p className="text-[10px] text-amber-800 leading-relaxed font-bold">
                ⚠️ 提示：您当前处于线上单审批资料锁定期。任何信息的更新都需要通过后台管理人员审核，请勿擅自提交虚假照片，稽核中心将实时跟进审计。
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleOnlineAppSubmit} className="space-y-4">
            {/* FORM INPUTS */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-2xs text-left">
              <div className="flex items-center space-x-1.5 border-b border-slate-50 pb-2">
                <User className="w-4 h-4 text-slate-800" />
                <span className="text-xs font-black text-slate-900">1. 代驾基本履历登记</span>
              </div>

              {/* Registered Driver Mobile (Read-only) */}
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 block uppercase tracking-wider">
                  当前登录司机注册手机号 (默认不可更改)
                </label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={userPhone || '未登录'}
                    disabled
                    className="w-full h-11 bg-slate-100 border border-slate-200 rounded-xl px-3 text-xs font-black text-slate-500 font-mono cursor-not-allowed"
                  />
                  <span className="absolute right-3 top-3 text-[9px] font-bold text-slate-400 bg-slate-200/50 px-1.5 py-0.5 rounded">不可篡改</span>
                </div>
              </div>

              {/* 线上单开通城市 */}
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 block uppercase tracking-wider">
                  线上单开通城市 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (onlineApp && (onlineApp.status === 'approved' || onlineApp.status === 'pending')) {
                        setLocalAlert({
                          title: "🔒 锁定提示",
                          message: "线上开通城市由省市运管中心登记认证。申请流程中及通过核准后无法自行修改变更，如需变更，请联系后台运营管理人员调整修改。",
                          type: "warning"
                        });
                        return;
                      }
                      setShowCitySelector(true);
                    }}
                    className={`w-full h-11 border rounded-xl px-3 flex items-center justify-between text-left text-xs font-extrabold font-sans transition-all active:scale-99 cursor-pointer ${
                      applicantCity ? 'text-teal-600 bg-teal-50/10 border-teal-200' : 'text-slate-400 bg-slate-50 border-slate-200'
                    }`}
                  >
                    <span className="truncate">{applicantCity ? `📍 ${applicantCity}` : '🔍 点击选择开通听单城市 (首字母快速查找)'}</span>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                </div>
              </div>

              {/* Driver Name & Gender Input Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 block">
                    司机姓名 <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    required
                    value={applicantName}
                    onChange={(e) => setApplicantName(e.target.value)}
                    placeholder="请输入姓名"
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 block">
                    司机性别 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={applicantGender}
                    onChange={(e) => setApplicantGender(e.target.value)}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800 cursor-pointer"
                  >
                    <option value="男">男 (Male)</option>
                    <option value="女">女 (Female)</option>
                  </select>
                </div>
              </div>

              {/* Driver Age & Driving Experience Years Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 block">
                    司机年龄 <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="number" 
                    required
                    min="18"
                    max="70"
                    value={applicantAge}
                    onChange={(e) => setApplicantAge(e.target.value)}
                    placeholder="例：35"
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800 hover:shadow-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 block">
                    驾龄多少年 <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="number" 
                    required
                    min="1"
                    max="50"
                    value={applicantDrivingYears}
                    onChange={(e) => setApplicantDrivingYears(e.target.value)}
                    placeholder="年数"
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800 hover:shadow-xs"
                  />
                </div>
              </div>

              {/* Emergency Contact Mobile */}
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 block">
                  紧急联系人手机号码 <span className="text-red-500">*</span>
                </label>
                <input 
                  type="tel" 
                  required
                  pattern="1[3-9]\d{9}"
                  maxLength={11}
                  value={applicantEmergencyPhone}
                  onChange={(e) => setApplicantEmergencyPhone(e.target.value)}
                  placeholder="请输入紧急联系人的11位手机号"
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800 font-mono"
                />
              </div>
            </div>

            {/* GRAPHIC CREDENTIAL PHOTO UPLOADS */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-4 shadow-2xs text-left">
              <div className="flex items-center space-x-1.5 border-b border-slate-50 pb-2">
                <Camera className="w-4 h-4 text-slate-800" />
                <span className="text-xs font-black text-slate-900">2. 实名与执照影像档案上传</span>
              </div>

              {/* ID Card front and back upload elements */}
              <div className="space-y-2">
                <span className="text-[10.5px] font-black text-slate-700 block">居民身份证原始影像档案复印件</span>
                <div className="grid grid-cols-2 gap-3">
                  {/* Front Card */}
                  <div className="relative">
                    <input 
                      type="file" 
                      id="online-app-upload-id-front" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => handleFileChange(e, setIdCardFront)} 
                    />
                    <div 
                      onClick={() => document.getElementById('online-app-upload-id-front')?.click()}
                      className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                        idCardFront ? 'border-teal-400 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                      }`}
                    >
                      {idCardFront ? (
                        <img src={idCardFront} className="w-full h-full object-cover rounded-lg" alt="身份证人像" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="space-y-1">
                          <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                          <span className="text-[9.5px] font-extrabold text-slate-500 block">身份证【人像面】</span>
                          <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                        </div>
                      )}
                    </div>
                    {idCardFront && (
                      <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); setIdCardFront(''); }}
                        className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10 cursor-pointer"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    )}
                  </div>

                  {/* Back Card */}
                  <div className="relative">
                    <input 
                      type="file" 
                      id="online-app-upload-id-back" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => handleFileChange(e, setIdCardBack)} 
                    />
                    <div 
                      onClick={() => document.getElementById('online-app-upload-id-back')?.click()}
                      className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                        idCardBack ? 'border-teal-400 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                      }`}
                    >
                      {idCardBack ? (
                        <img src={idCardBack} className="w-full h-full object-cover rounded-lg" alt="国徽面" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="space-y-1">
                          <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                          <span className="text-[9.5px] font-extrabold text-slate-500 block">身份证【国徽面】</span>
                          <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                        </div>
                      )}
                    </div>
                    {idCardBack && (
                      <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); setIdCardBack(''); }}
                        className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10 cursor-pointer"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Driver License front and back upload elements */}
              <div className="space-y-2">
                <span className="text-[10.5px] font-black text-slate-700 block">机动车驾驶证原始影像档案复印件</span>
                <div className="grid grid-cols-2 gap-3">
                  {/* Front License */}
                  <div className="relative">
                    <input 
                      type="file" 
                      id="online-app-upload-license-front" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => handleFileChange(e, setDriverLicenseFront)} 
                    />
                    <div 
                      onClick={() => document.getElementById('online-app-upload-license-front')?.click()}
                      className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                        driverLicenseFront ? 'border-teal-400 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                      }`}
                    >
                      {driverLicenseFront ? (
                        <img src={driverLicenseFront} className="w-full h-full object-cover rounded-lg" alt="驾驶证正" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="space-y-1">
                          <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                          <span className="text-[9.5px] font-extrabold text-slate-500 block">驾驶证【正页】</span>
                          <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                        </div>
                      )}
                    </div>
                    {driverLicenseFront && (
                      <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); setDriverLicenseFront(''); }}
                        className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10 cursor-pointer"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    )}
                  </div>

                  {/* Back License */}
                  <div className="relative">
                    <input 
                      type="file" 
                      id="online-app-upload-license-back" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => handleFileChange(e, setDriverLicenseBack)} 
                    />
                    <div 
                      onClick={() => document.getElementById('online-app-upload-license-back')?.click()}
                      className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                        driverLicenseBack ? 'border-teal-400 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                      }`}
                    >
                      {driverLicenseBack ? (
                        <img src={driverLicenseBack} className="w-full h-full object-cover rounded-lg" alt="驾驶证副" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="space-y-1">
                          <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                          <span className="text-[9.5px] font-extrabold text-slate-500 block">驾驶证【副页】</span>
                          <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                        </div>
                      )}
                    </div>
                    {driverLicenseBack && (
                      <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); setDriverLicenseBack(''); }}
                        className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10 cursor-pointer"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Submitting controller & Actions */}
            <div className="pt-2 text-center">
              <button
                type="submit"
                disabled={submittingApp || !applicantName.trim() || !applicantAge.trim() || !applicantEmergencyPhone.trim() || !applicantDrivingYears.trim() || !idCardFront || !idCardBack || !driverLicenseFront || !driverLicenseBack}
                className={`w-full h-11 rounded-xl font-bold text-xs flex items-center justify-center transition-all cursor-pointer ${
                  (applicantName.trim() && applicantAge.trim() && applicantEmergencyPhone.trim() && applicantDrivingYears.trim() && idCardFront && idCardBack && driverLicenseFront && driverLicenseBack)
                    ? 'bg-gradient-to-r from-teal-600 to-indigo-650 text-white hover:opacity-95 shadow-md shadow-indigo-600/10 active:scale-97'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                {submittingApp ? (
                  <span className="flex items-center space-x-1">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>正在同步双轨资质数据至后台...</span>
                  </span>
                ) : (
                  <span>提交开通申请 (实名联合认证)</span>
                )}
              </button>
              <p className="text-[9px] text-center text-slate-400 font-normal mt-2 leading-relaxed">
                信息将采用全信加密存储，保证隐私安全。每个手机账户在绑定状态下仅支持一宗注册申请审计，严禁上传非本人的虚假伪造凭据。
              </p>
            </div>
          </form>
        )}
      </div>

      {/* City Selection Modal */}
      {showCitySelector && (
        <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Header */}
          <div className="bg-slate-900 text-white header-safe-pt pb-3 px-4 flex items-center justify-between shrink-0 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <MapPin className="w-4.5 h-4.5 text-teal-400" />
              <div className="text-left">
                <h3 className="font-extrabold text-xs text-white">选择听单城市</h3>
                <span className="text-[9px] text-slate-400 font-normal">支持首字母拼音快速跳转检索</span>
              </div>
            </div>
            <button 
              type="button"
              onClick={() => {
                setShowCitySelector(false);
                setSearchCityQuery('');
              }}
              className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-90 cursor-pointer"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Search Bar */}
          <div className="bg-white p-3 border-b border-slate-100 shrink-0">
            <div className="relative">
              <input
                type="text"
                value={searchCityQuery}
                onChange={(e) => setSearchCityQuery(e.target.value)}
                placeholder="输入城市中文名或拼音检索（如：北京 / Beijing）"
                className="w-full h-10 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl pl-9 pr-8 text-xs font-semibold text-slate-800 transition-all"
              />
              <span className="absolute left-3 top-3 text-slate-400">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.637 10.637z" />
                </svg>
              </span>
              {searchCityQuery && (
                <button
                  type="button"
                  onClick={() => setSearchCityQuery('')}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Main Area */}
          <div className="flex-1 overflow-y-auto relative min-h-0">
            {searchCityQuery.trim() ? (
              <div className="p-4 space-y-2">
                <span className="text-[10px] font-black text-slate-400 block tracking-wider uppercase">搜索结果</span>
                {(() => {
                  const filtered = ALL_CITIES_FLAT.filter(city => 
                    city.name.includes(searchCityQuery.trim()) || 
                    city.pinyin.toLowerCase().includes(searchCityQuery.trim().toLowerCase())
                  );

                  if (filtered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                        <MapPin className="w-8 h-8 text-slate-300 stroke-1" />
                        <span className="text-xs">未找到名称含 “{searchCityQuery}” 的城市</span>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-3 gap-2">
                      {filtered.map(city => (
                        <button
                          key={city.name}
                          type="button"
                          onClick={() => {
                            setApplicantCity(city.name);
                            setShowCitySelector(false);
                            setSearchCityQuery('');
                          }}
                          className={`py-2 px-1 text-center text-xs font-black rounded-xl border transition-all cursor-pointer ${
                            applicantCity === city.name 
                              ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-xs' 
                              : 'bg-white hover:bg-slate-50 border-slate-200/60 text-slate-700 shadow-3xs'
                          }`}
                        >
                          {city.name}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="pr-8 pl-4 py-4 space-y-4">
                {/* Current Selection */}
                <div className="space-y-1.5 text-left">
                  <span className="text-[10px] font-black text-slate-400 block tracking-wider uppercase">当前选择</span>
                  <div className="flex">
                    <div className={`py-2 px-4 text-xs font-black rounded-xl border flex items-center space-x-1 ${
                      applicantCity ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-slate-100 border-slate-200 text-slate-400'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
                      <span>{applicantCity ? `已选择：${applicantCity}` : '暂无选择'}</span>
                    </div>
                  </div>
                </div>

                {/* Popular Cities */}
                <div className="space-y-2 text-left">
                  <span className="text-[10px] font-black text-slate-400 block tracking-wider uppercase">热门城市</span>
                  <div className="grid grid-cols-3 gap-2">
                    {['北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '西安', '重庆'].map(name => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          setApplicantCity(name);
                          setShowCitySelector(false);
                          setSearchCityQuery('');
                        }}
                        className={`py-2 px-1 text-center text-xs font-black rounded-xl border transition-all cursor-pointer ${
                          applicantCity === name 
                            ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-xs' 
                            : 'bg-white hover:bg-slate-50 border-slate-200/60 text-slate-700 shadow-3xs'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Directory by Alphabet letters */}
                <div className="space-y-4 text-left">
                  {CITY_GROUPS.map(group => (
                    <div key={group.letter} id={`city-letter-${group.letter}`} className="scroll-mt-4 space-y-2">
                      <div className="bg-slate-100/80 backdrop-blur-xs rounded-lg px-2.5 py-0.5 inline-block text-[10px] font-extrabold text-slate-600 font-mono tracking-wide">
                        {group.letter}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {group.cities.map(city => (
                          <button
                            key={city.name}
                            type="button"
                            onClick={() => {
                              setApplicantCity(city.name);
                              setShowCitySelector(false);
                              setSearchCityQuery('');
                            }}
                            className={`py-2 px-1 text-center text-xs font-black rounded-xl border transition-all cursor-pointer ${
                              applicantCity === city.name 
                                ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-xs' 
                                : 'bg-white hover:bg-slate-50 border-slate-200/60 text-slate-700 shadow-3xs'
                            }`}
                          >
                            {city.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Floating Right Sidebar Alphabet Index */}
            {!searchCityQuery && (
              <div className="absolute right-1 top-4 bottom-4 w-6 flex flex-col justify-between items-center py-2 bg-white/60 backdrop-blur-xs border border-slate-100 rounded-2xl z-25 shadow-2xs">
                {CITY_GROUPS.map(group => (
                  <button
                    key={group.letter}
                    type="button"
                    onClick={() => {
                      const element = document.getElementById(`city-letter-${group.letter}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    className="w-5 h-5 flex items-center justify-center text-[9px] font-black text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-full transition-all cursor-pointer"
                  >
                    {group.letter}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom pop-up dialog */}
      {localAlert && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-[280px] bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200 text-center p-4 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center bg-teal-50 text-teal-600">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-extrabold text-slate-800">{localAlert.title}</h4>
              <p className="text-[11px] text-slate-600 leading-relaxed font-sans px-2">{localAlert.message}</p>
            </div>
            <button
              onClick={() => setLocalAlert(null)}
              className="w-full h-9 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-800 active:scale-98 transition-all cursor-pointer"
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
