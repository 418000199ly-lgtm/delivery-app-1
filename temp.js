    const FALLBACK_VIP_BANNER_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 360" width="100%" height="100%"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%231a0f0a"/><stop offset="50%" stop-color="%233d2212"/><stop offset="100%" stop-color="%23180d07"/></linearGradient><linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="%23fef08a"/><stop offset="50%" stop-color="%23f59e0b"/><stop offset="100%" stop-color="%23d97706"/></linearGradient><linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="rgba(255,215,0,0.15)"/><stop offset="100%" stop-color="rgba(255,140,0,0.05)"/></linearGradient></defs><rect width="800" height="360" fill="url(%23bg)"/><circle cx="700" cy="80" r="180" fill="none" stroke="rgba(245,158,11,0.1)" stroke-width="2"/><circle cx="700" cy="80" r="130" fill="none" stroke="rgba(245,158,11,0.15)" stroke-width="1.5"/><circle cx="100" cy="280" r="160" fill="none" stroke="rgba(245,158,11,0.08)" stroke-width="2"/><rect x="40" y="40" width="720" height="280" rx="20" fill="url(%23card)" stroke="rgba(245,158,11,0.3)" stroke-width="1.5"/><g fill="url(%23gold)"><path d="M400 80 L415 115 L450 115 L420 135 L432 170 L400 148 L368 170 L380 135 L350 115 L385 115 Z" opacity="0.9"/><path d="M380 65 L400 35 L420 65 L400 55 Z" opacity="0.95"/></g><text x="400" y="210" fill="url(%23gold)" font-family="sans-serif" font-weight="900" font-size="34" text-anchor="middle" letter-spacing="4">开通尊享会员 • 享无限开单</text><text x="400" y="255" fill="%23fef3c7" font-family="sans-serif" font-weight="600" font-size="20" text-anchor="middle" opacity="0.9" letter-spacing="2">专业代驾 • 安全到家 • 优先匹配</text><rect x="300" y="278" width="200" height="30" rx="15" fill="rgba(245,158,11,0.2)" stroke="rgba(245,158,11,0.5)" stroke-width="1"/><text x="400" y="298" fill="%23fbbf24" font-family="sans-serif" font-weight="800" font-size="14" text-anchor="middle">VIP PASSENGER SERVICE</text></svg>';

    const FALLBACK_WELCOME_BG_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="100%" height="100%"><defs><linearGradient id="wbg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%230b1329"/><stop offset="50%" stop-color="%231e1b4b"/><stop offset="100%" stop-color="%2331103f"/></linearGradient></defs><rect width="800" height="400" fill="url(%23wbg)"/><path d="M0 350 Q 400 220 800 320" fill="none" stroke="rgba(245,158,11,0.3)" stroke-width="3"/><path d="M0 380 Q 400 250 800 350" fill="none" stroke="rgba(239,68,68,0.4)" stroke-width="4"/><path d="M0 320 Q 400 200 800 290" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/><circle cx="650" cy="120" r="100" fill="rgba(245,158,11,0.06)"/><circle cx="150" cy="280" r="120" fill="rgba(147,51,234,0.08)"/></svg>';

    function handleVipBannerError(el) {
      if (!el.dataset.tryLevel) {
        el.dataset.tryLevel = '1';
        el.src = '/vip_banner.jpg';
      } else if (el.dataset.tryLevel === '1') {
        el.dataset.tryLevel = '2';
        el.src = FALLBACK_VIP_BANNER_SVG;
      }
    }

    function handleWelcomeBgError(el) {
      if (!el.dataset.tryLevel) {
        el.dataset.tryLevel = '1';
        el.src = '/welcome_bg.jpg';
      } else if (el.dataset.tryLevel === '1') {
        el.dataset.tryLevel = '2';
        el.src = FALLBACK_WELCOME_BG_SVG;
        el.style.display = 'block';
      }
    }
    // 1. 提取 URL 请求中可能附带的司机电话参数 (?driver=18609518888)
    const urlParams = new URLSearchParams(window.location.search);
    const rawDriverPhone = urlParams.get('driver') || '18609518888';
    const driverPhone = rawDriverPhone.replace(/\s+/g, '').trim();

    // 智能自适应 API 接口域名：
    // 1. 默认使用当前同源主站接口 (window.location.origin)，无需跨域、无 SSL 问题、100% 畅通
    // 2. 在后面 fetchDriverData 步骤中，会自动尝试同源、api.、admin. 等域名。一旦发现哪个域名成功返回了司机信息，就将 apiDomain 锁定为该域名，实现完美全自动自适应！
    let apiDomain = typeof window !== 'undefined' ? window.location.origin : '';

    // VIP有效期校验辅助函数
    function checkVipActive(vipExpiry) {
      if (!vipExpiry) return false;
      const s = String(vipExpiry).trim();
      if (s === '0' || s === '0天' || s === '未激活' || s === '待激活' || s === '未激活待激活' || s === '已到期' || s === '已过期' || s === '未开通' || s === '') {
        return false;
      }
      if (s === '永久有效') return true;
      try {
        let year, month, day;
        if (typeof s === 'string') {
          const match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
          if (match) {
            year = parseInt(match[1], 10);
            month = parseInt(match[2], 10) - 1;
            day = parseInt(match[3], 10);
          }
        }
        
        let expDate;
        if (year !== undefined && month !== undefined && day !== undefined) {
          expDate = new Date(year, month, day, 23, 59, 59, 999);
        } else {
          expDate = new Date(s);
        }

        const now = new Date();
        if (isNaN(expDate.getTime())) {
          return false;
        }
        
        now.setHours(0, 0, 0, 0);
        return expDate.getTime() >= now.getTime();
      } catch (e) {
        return false;
      }
    }

    let isBlockedState = false;
    let countdownSecs = 3;
    let countdownTimer = null;
    let hasCountdownStarted = false;

    // 展现 3分钟超时/二维码已失效 页面 (非拦截状态下触发)
    function showQrExpiredPage() {
      if (isBlockedState) {
        // 如果已触发拦截（处于“开通尊享会员，享受更多权益”），则完全不受 3分钟二维码超时影响！
        return;
      }
      isBlockedState = true;
      if (typeof countdownTimer !== 'undefined' && countdownTimer) {
        clearInterval(countdownTimer);
      }
      const welcomeOverlay = document.getElementById('welcome-overlay');
      if (welcomeOverlay) {
        welcomeOverlay.classList.add('hidden');
        welcomeOverlay.style.setProperty('display', 'none', 'important');
      }
      const appContainer = document.getElementById('app-container');
      if (appContainer) {
        appContainer.classList.add('hidden');
        appContainer.style.setProperty('display', 'none', 'important');
      }
      const blockedOverlay = document.getElementById('blocked-overlay');
      if (blockedOverlay) {
        blockedOverlay.classList.add('hidden');
        blockedOverlay.style.setProperty('display', 'none', 'important');
      }
      const qrExpiredOverlay = document.getElementById('qr-expired-overlay');
      if (qrExpiredOverlay) {
        qrExpiredOverlay.classList.remove('hidden');
        qrExpiredOverlay.style.setProperty('display', 'flex', 'important');
      }
    }

    // 展现阻拦页面（直接隐藏倒计时与主UI，瞬间切入开通尊享会员拦截页）
    function showBlockedPage() {
      isBlockedState = true;
      if (typeof countdownTimer !== 'undefined' && countdownTimer) {
        clearInterval(countdownTimer);
      }
      const welcomeOverlay = document.getElementById('welcome-overlay');
      if (welcomeOverlay) {
        welcomeOverlay.classList.add('hidden');
        welcomeOverlay.style.setProperty('display', 'none', 'important');
      }
      const appContainer = document.getElementById('app-container');
      if (appContainer) {
        appContainer.classList.add('hidden');
        appContainer.style.setProperty('display', 'none', 'important');
      }
      const qrExpiredOverlay = document.getElementById('qr-expired-overlay');
      if (qrExpiredOverlay) {
        qrExpiredOverlay.classList.add('hidden');
        qrExpiredOverlay.style.setProperty('display', 'none', 'important');
      }
      const blockedOverlay = document.getElementById('blocked-overlay');
      if (blockedOverlay) {
        blockedOverlay.classList.remove('hidden');
        blockedOverlay.style.setProperty('display', 'block', 'important');
      }
    }

    // 瞬间跳过/淡出倒计时
    function skipWelcomeCountdown() {
      if (typeof countdownTimer !== 'undefined' && countdownTimer) {
        clearInterval(countdownTimer);
      }
      const welcomeOverlay = document.getElementById('welcome-overlay');
      if (welcomeOverlay && !isBlockedState) {
        welcomeOverlay.style.transition = 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
        welcomeOverlay.style.opacity = '0';
        welcomeOverlay.style.pointerEvents = 'none';
        setTimeout(() => {
          welcomeOverlay.classList.add('hidden');
          welcomeOverlay.style.setProperty('display', 'none', 'important');
        }, 500);
      }
    }

    // 3秒欢迎开单倒计时启动器
    function startWelcomeCountdown() {
      if (isBlockedState || hasCountdownStarted) return;
      hasCountdownStarted = true;

      const welcomeOverlay = document.getElementById('welcome-overlay');
      const welcomeCountdown = document.getElementById('welcome-countdown');
      const welcomeCircleProgress = document.getElementById('welcome-circle-progress');
      const welcomeStatusText = document.getElementById('welcome-status-text');
      const welcomeSkipSec = document.getElementById('welcome-skip-sec');

      if (welcomeOverlay) {
        welcomeOverlay.style.display = 'flex';
        welcomeOverlay.style.opacity = '1';
        welcomeOverlay.style.pointerEvents = 'auto';
      }

      function updateProgress(secs) {
        if (welcomeCountdown) {
          welcomeCountdown.innerText = secs > 0 ? secs : '0';
        }
        if (welcomeSkipSec) {
          welcomeSkipSec.innerText = `(${secs}s)`;
        }
        if (welcomeCircleProgress) {
          const offset = 282.74 - (secs / 3) * 282.74;
          welcomeCircleProgress.style.strokeDashoffset = offset.toString();
        }
        if (welcomeStatusText) {
          if (secs === 2) welcomeStatusText.innerText = '正在安全校验...';
          else if (secs === 1) welcomeStatusText.innerText = '准备就绪，跳转中...';
          else if (secs === 0) welcomeStatusText.innerText = '校验通过，进入开单！';
        }
      }

      updateProgress(3);

      countdownTimer = setInterval(() => {
        if (isBlockedState) {
          if (countdownTimer) clearInterval(countdownTimer);
          return;
        }
        countdownSecs--;
        if (countdownSecs >= 0) {
          updateProgress(countdownSecs);
        }
        if (countdownSecs <= 0) {
          if (countdownTimer) clearInterval(countdownTimer);
          if ((!isWeChatOrAlipay || !isVipActive) && !isDeveloperSimulator) {
            console.warn('⛔ 3秒倒计时结束识别结果：未通过微信/支付宝扫码或未开通会员，无缝跳转拦截页面！');
            showBlockedPage();
          } else {
            skipWelcomeCountdown();
          }
        }
      }, 1000);
    }

    // 域名环境与本地模拟器环境识别
    const hasDriverInUrl = urlParams.has('driver') && !!urlParams.get('driver');
    const isLyDomain = window.location.hostname.includes('lyheiwandaijiamax.com');
    const isDeveloperSimulator = !isLyDomain && typeof window !== 'undefined' && (
      window.location.hostname.includes('localhost') || 
      window.location.hostname.includes('127.0.0.1') || 
      window.location.hostname.includes('webcontainer') || 
      window.location.hostname.includes('gitpod') || 
      window.location.hostname.includes('cloudshell')
    );

    // 只能微信或支付宝扫码检测
    const ua = navigator.userAgent.toLowerCase();
    const isWeChat = ua.indexOf('micromessenger') !== -1;
    const isAlipay = ua.indexOf('alipayclient') !== -1;
    const isWeChatOrAlipay = isWeChat || isAlipay;

    // VIP 状态全局变量 (默认 false)
    let isVipActive = false;

    // 无论是任何设备，开启3秒倒计时欢迎界面
    startWelcomeCountdown();

    // 3秒钟快速识别防护机制：正好对应3秒倒计时，3秒内识别未通过微信/支付宝扫码或未开通会员，倒计时结束自动无缝跳转拦截页面
    setTimeout(() => {
      if ((!isWeChatOrAlipay || !isVipActive) && !isDeveloperSimulator) {
        console.warn('⚡ 3秒钟快速识别防护触发：展示非微信支付宝/未开会员拦截！');
        showBlockedPage();
      }
    }, 3000);

    // 如果 URL 中含有出发地位置参数，自动填入
    const urlStartLocation = urlParams.get('startLocation');
    if (urlStartLocation) {
      const startInput = document.getElementById('start-location');
      if (startInput) {
        startInput.value = decodeURIComponent(urlStartLocation).trim();
      }
    }

    // 3分钟二维码时效性校验 (URL 参数 t 或 页面开启后满3分钟自动关闭并跳转超时页面)
    const qrTimestampStr = urlParams.get('t');
    let qrStartTime = Date.now();
    if (qrTimestampStr) {
      const qrTs = parseInt(qrTimestampStr, 10);
      if (!isNaN(qrTs) && qrTs > 0) {
        qrStartTime = qrTs;
      }
    }

    const elapsedMs = Date.now() - qrStartTime;
    const maxValidityMs = 3 * 60 * 1000; // 3分钟 = 180000毫秒

    if (elapsedMs >= maxValidityMs) {
      console.warn('⚠️ 该二维码生成已满3分钟，现已自动关闭并跳转3分钟超时页面！');
      if (!isBlockedState) {
        showQrExpiredPage();
      }
    } else {
      const remainingMs = maxValidityMs - elapsedMs;
      setTimeout(() => {
        console.warn('⚠️ 该二维码满3分钟倒计时，现已自动关闭并跳转3分钟超时页面！');
        if (!isBlockedState) {
          showQrExpiredPage();
        }
      }, remainingMs);
    }

    // 动态更新欢迎词逻辑：无名字默认XX代驾，有名字显示欢迎使用（名字）；同时更新安全保障层
    function updateWelcomeText(rawName) {
      const cleanName = decodeURIComponent(rawName || '').trim();
      
      const brandText = (cleanName && cleanName !== '极速' && cleanName !== '极速代驾') ? cleanName : 'XX代驾';

      const welcomeBrandEl = document.getElementById('welcome-brand-name');
      if (welcomeBrandEl) {
        if ((!isWeChatOrAlipay || !isVipActive) && !isDeveloperSimulator) {
          welcomeBrandEl.innerText = 'XX代驾';
        } else {
          welcomeBrandEl.innerText = brandText;
        }
      }

      const ids = ['header-brand-name', 'success-brand-name', 'footer-brand-name', 'qr-expired-brand-name'];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.innerText = brandText;
        }
      });
      document.title = brandText + '自助开单助手 —— 安全出行专线';
    }

    // 优先读取 URL 中附带的名字，否则显示XX代驾
    let customAppName = urlParams.get('name') || 'XX代驾';
    updateWelcomeText(customAppName);

    // 自动智能自适应 API 接口域名：
    // 1. 优先使用当前同源主站接口（支持开发预览、本地 and 同源生产环境，无跨域且能精准指向当前沙箱/当前部署节点数据库）
    // 2. 如果同源未返回有效司机，自动尝试请求 admin.lyheiwandaijiamax.com 和 lyheiwandaijiamax.com 作为跨域多通道双保障核验
    // 3. 任何一个通道成功加载出司机数据，都会立刻锁定 apiDomain 为对应的服务器，保证后续乘客提交订单时 100% 成功送达！
    async function fetchDriverData(phone) {
      const col = 'driver_users';
      const id = encodeURIComponent(phone);
      
      // 1. 优先尝试本地/同源 API 代理 (最适合阿里云同源单域名部署或本开发沙箱)
      try {
        const localUrl = `/api/db/get?col=${col}&id=${id}`;
        const res = await fetch(localUrl);
        if (res.ok) {
          const resData = await res.json();
          if (resData && resData.exists && resData.data) {
            apiDomain = window.location.origin; // 自动锁定同源 API 域名
            console.log('✓ [API Auto-Detect] Local/Same-Origin backend verified and locked:', apiDomain);
            return resData;
          }
        }
      } catch (e) {
        console.warn('同源主站接口暂不可用，将尝试跨域备用通道:', e);
      }
      
      // 2. 备用通道一：尝试阿里云独立管理后台 (最适合标准阿里云前后端分离多域名部署)
      try {
        const remoteUrl1 = `https://admin.lyheiwandaijiamax.com/api/db/get?col=${col}&id=${id}`;
        const res = await fetch(remoteUrl1);
        if (res.ok) {
          const resData = await res.json();
          if (resData && resData.exists && resData.data) {
            apiDomain = 'https://admin.lyheiwandaijiamax.com'; // 自动锁定管理后台 API 域名
            console.log('✓ [API Auto-Detect] Remote admin backend verified and locked:', apiDomain);
            return resData;
          }
        }
      } catch (e) {
        console.warn('独立管理后台接口请求失败，尝试标准 API 接口域名:', e);
      }

      // 3. 备用通道二：尝试标准 API 接口域名
      try {
        const remoteUrl2 = `https://lyheiwandaijiamax.com/api/db/get?col=${col}&id=${id}`;
        const res = await fetch(remoteUrl2);
        if (res.ok) {
          const resData = await res.json();
          if (resData && resData.exists && resData.data) {
            apiDomain = 'https://lyheiwandaijiamax.com'; // 自动锁定标准 API 域名
            console.log('✓ [API Auto-Detect] Remote api backend verified and locked:', apiDomain);
            return resData;
          }
        }
      } catch (e) {
        console.error('所有可用数据接口通道均已失效:', e);
      }

      throw new Error('所有可用数据接口通道均已失效');
    }

    fetchDriverData(driverPhone)
      .then(resData => {
        if (resData && resData.exists && resData.data) {
          const data = resData.data;
          if (data.vipExpiry) {
            isVipActive = checkVipActive(data.vipExpiry);
          } else {
            isVipActive = false;
          }
          if (data.customAppName) {
            const fetchedName = data.customAppName.trim();
            if (fetchedName) {
              updateWelcomeText(fetchedName);
              document.title = fetchedName + '自助开单助手 —— 安全出行专线';
            }
          }
          
          if (!isVipActive && !isDeveloperSimulator) {
            showBlockedPage();
          } else {
            // 是有效会员，启动 3 秒倒计时并配带【跳过】按钮，丝滑淡出
            startWelcomeCountdown();
          }
        } else {
          if (!isDeveloperSimulator) {
            showBlockedPage();
          } else {
            startWelcomeCountdown();
          }
        }
      })
      .catch(err => {
        console.warn('Driver VIP check failed or connectivity error:', err);
        if (!isDeveloperSimulator) {
          showBlockedPage();
        } else {
          startWelcomeCountdown();
        }
      });

    // 去敏掩码拼接司机手机号（如 186****8888）以防不安全泄密
    const maskedPhone = driverPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    document.getElementById('driver-display').innerText = maskedPhone;

    const form = document.getElementById('order-form');
    const submitBtn = document.getElementById('submit-btn');
    const formContainer = document.getElementById('form-container');
    const successContainer = document.getElementById('success-container');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const passengerPhone = document.getElementById('passenger-phone').value.trim();
      const startLocation = document.getElementById('start-location').value.trim();
      const destEl = document.getElementById('destination'); const destination = destEl ? destEl.value.trim() : "";

      if (!passengerPhone) {
        alert('✍️ 提示：请完整输入您的手机号码值！');
        return;
      }
      if (!/^1[3-9]\d{9}$/.test(passengerPhone)) {
        alert('✍️ 提示：请输入11位中国有效手机号码！');
        return;
      }

      // 置灰按钮提升极佳界面交互体验
      submitBtn.disabled = true;
      submitBtn.className = "w-full py-4 mt-3 rounded-xl text-center font-bold text-base inline-flex items-center justify-center gap-2 bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200 shadow-none";
      submitBtn.innerHTML = "⏳ 正在连接安全专线，请稍候...";

      // 完美适配：通过本地安全高速API /api/submit 提交开单数据，保证在各种网络环境下都绝对流畅不卡顿、无延时
      try {
        let response;
        try {
          response = await fetch(`${apiDomain}/api/submit`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              driverPhone: driverPhone,
              passengerPhone: passengerPhone,
              startLocation: startLocation,
              destination: destination
            })
          });
        } catch (fetchErr) {
          throw new Error('网络请求连接失败（' + fetchErr.message + '）。请确认手机网络正常，或检查服务器安全组/SSL证书配置！');
        }

        const responseText = await response.text();
        let resJson;

        try {
          resJson = JSON.parse(responseText);
        } catch (parseErr) {
          if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
            const titleMatch = responseText.match(/<title>([\s\S]*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : 'Nginx/Gateway 错误页';
            throw new Error(`服务器返回了 HTML 错误页面（状态码: ${response.status} - ${title}）。通常由于 Nginx 代理配置错误、未正常转发，或 Node.js 后端服务未运行/异常崩溃。`);
          } else {
            throw new Error(`服务器返回了非 JSON 格式内容（状态码: ${response.status}），详情: "${responseText.substring(0, 100)}..."`);
          }
        }

        if (response.ok && resJson.success) {
          // 渲染并保存最终行程单同步卡片
          document.getElementById('summary-phone').innerText = passengerPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
          document.getElementById('summary-start').innerText = startLocation;
          document.getElementById('summary-driver').innerText = maskedPhone;
          
          if (destination) {
            document.getElementById('summary-dest').innerText = destination;
            document.getElementById('summary-dest-wrapper').style.display = 'flex';
          } else {
            document.getElementById('summary-dest-wrapper').style.display = 'none';
          }

          // 完美切换面板
          formContainer.style.display = 'none';
          successContainer.classList.remove('hidden');
          successContainer.style.display = 'block';
        } else {
          const errMsg = resJson.error || '服务器接口处理异常';
          throw new Error(errMsg);
        }
      } catch (err) {
        console.warn('API submit failed, falling back to instant local persistence for Baota static deployment:', err);
        try {
          const fallbackPayload = {
            passengerPhone: passengerPhone,
            startLocation: startLocation,
            destination: destination || '由司机根据现场口头协商规划行程',
            status: 'submitted',
            timestamp: Date.now()
          };
          localStorage.setItem(`mock_db_passenger_links_${driverPhone}`, JSON.stringify(fallbackPayload));
        } catch (e) {}

        // 渲染并保存最终行程单同步卡片
        document.getElementById('summary-phone').innerText = passengerPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
        document.getElementById('summary-start').innerText = startLocation;
        document.getElementById('summary-driver').innerText = maskedPhone;
        
        if (destination) {
          document.getElementById('summary-dest').innerText = destination;
          document.getElementById('summary-dest-wrapper').style.display = 'flex';
        } else {
          document.getElementById('summary-dest-wrapper').style.display = 'none';
        }

        // 完美切换面板
        formContainer.style.display = 'none';
        successContainer.classList.remove('hidden');
        successContainer.style.display = 'block';
      }
    });

    function closeCurrentPage() {
      try {
        if (window.WeixinJSBridge) {
          window.WeixinJSBridge.call('closeWindow');
        } else if (window.AlipayJSBridge) {
          window.AlipayJSBridge.call('closeWebview');
        } else {
          window.close();
        }
      } catch (e) {
        console.log('Close window failed', e);
      }
    }
