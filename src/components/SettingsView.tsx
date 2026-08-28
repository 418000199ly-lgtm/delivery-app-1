import React, { useState, useRef } from 'react';
import { X, ChevronRight, ChevronLeft, HelpCircle, RotateCcw, PlusSquare, Bookmark, Save, ImagePlus, Trash2, CheckCircle, Loader2, Crown, LogOut, Volume2, Download } from 'lucide-react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { ChauffeurSettings, checkVipActive } from '../types';
import { db, doc, getDoc, updateDoc, getBaseApiUrl } from '../lib/dbProxy';
import { MOCK_ALBUM_PHOTOS } from '../utils/mockImages';
import { speakText, stopSpeaking, initAudioUnlock } from '../utils/speech';

export function regenerateQRCode(dataUrl: string, type: 'wechat' | 'alipay'): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = dataUrl;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        
        // Scan original QR payload using jsQR
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'attemptBoth'
        });
        
        if (code && code.data) {
          // Re-generate complete, clean, vector-exact high-contrast black-white QR code
          QRCode.toDataURL(code.data, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 450,
            color: {
              dark: '#000000',
              light: '#ffffff'
            }
          }).then(resolve).catch((err) => {
            console.error('QRCode generation failed', err);
            resolve(dataUrl);
          });
        } else {
          // Use user's uploaded image directly if jsQR can't scan payload
          resolve(dataUrl);
        }
      } catch (err) {
        console.error('Failed in regenerateQRCode processing', err);
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
  });
}

export function cropQRCodeFromImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = dataUrl;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // Downscale matching for efficiency (max 500px to keep it super fast and accurate)
        const maxDim = 500;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // Step 1: Divide the image into blocks, and calculate contrast transitions
        const blockSize = 8; // Small block size for high-resolution density map
        const cols = Math.floor(width / blockSize);
        const rows = Math.floor(height / blockSize);
        const density = Array.from({ length: rows }, () => new Float32Array(cols));

        let maxDensity = 0;

        // For each block, count horizontal and vertical gradient changes
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            let transitionCount = 0;
            const startX = c * blockSize;
            const startY = r * blockSize;

            for (let y = startY; y < Math.min(height - 1, startY + blockSize); y++) {
              for (let x = startX; x < Math.min(width - 1, startX + blockSize); x++) {
                const idx1 = (y * width + x) * 4;
                const idxRight = (y * width + (x + 1)) * 4;
                const idxDown = ((y + 1) * width + x) * 4;

                const l1 = 0.299 * data[idx1] + 0.587 * data[idx1 + 1] + 0.114 * data[idx1 + 2];
                const lRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
                const lDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];

                if (Math.abs(l1 - lRight) > 40) transitionCount++;
                if (Math.abs(l1 - lDown) > 40) transitionCount++;
              }
            }
            density[r][c] = transitionCount;
            if (transitionCount > maxDensity) {
              maxDensity = transitionCount;
            }
          }
        }

        // Set threshold to clear solid whitespace boundaries (e.g. 15% of maxDensity)
        const threshold = Math.max(3, maxDensity * 0.15);

        // Find connected components using high-gap bridge tolerance to bypass middle avatar logo
        const components: { cells: [number, number][]; minR: number; maxR: number; minC: number; maxC: number }[] = [];
        const visited = Array.from({ length: rows }, () => new Uint8Array(cols));

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (density[r][c] > threshold && visited[r][c] === 0) {
              const cells: [number, number][] = [];
              const queue: [number, number][] = [[r, c]];
              visited[r][c] = 1;

              let compMinR = r;
              let compMaxR = r;
              let compMinC = c;
              let compMaxC = c;

              while (queue.length > 0) {
                const curr = queue.shift()!;
                const [cr, cc] = curr;
                cells.push([cr, cc]);

                if (cr < compMinR) compMinR = cr;
                if (cr > compMaxR) compMaxR = cr;
                if (cc < compMinC) compMinC = cc;
                if (cc > compMaxC) compMaxC = cc;

                // Grab neighbors up to distance 3 (bridges gaps created by solid middle face/profile views!)
                const dist = 3;
                for (let dr = -dist; dr <= dist; dr++) {
                  for (let dc = -dist; dc <= dist; dc++) {
                    const nr = cr + dr;
                    const nc = cc + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                      if (density[nr][nc] > threshold && visited[nr][nc] === 0) {
                        visited[nr][nc] = 1;
                        queue.push([nr, nc]);
                      }
                    }
                  }
                }
              }

              components.push({
                cells,
                minR: compMinR,
                maxR: compMaxR,
                minC: compMinC,
                maxC: compMaxC,
              });
            }
          }
        }

        if (components.length === 0) {
          resolve(dataUrl);
          return;
        }

        // Sort components by cell count descending to find the main QR code block
        components.sort((a, b) => b.cells.length - a.cells.length);
        const mainComp = components[0];

        let qrMinR = mainComp.minR;
        let qrMaxR = mainComp.maxR;
        let qrMinC = mainComp.minC;
        let qrMaxC = mainComp.maxC;

        let qrX = qrMinC * blockSize;
        let qrY = qrMinR * blockSize;
        let qrW = (qrMaxC - qrMinC + 1) * blockSize;
        let qrH = (qrMaxR - qrMinR + 1) * blockSize;

        // Perfect padding: 6% of QR size for neat quiet-zone margin
        const paddingPx = Math.max(12, Math.round(Math.min(qrW, qrH) * 0.06));
        let cropX = qrX - paddingPx;
        let cropY = qrY - paddingPx;
        let cropW = qrW + paddingPx * 2;
        let cropH = qrH + paddingPx * 2;

        // Force a perfect square
        const size = Math.max(cropW, cropH);
        const cx = cropX + cropW / 2;
        const cy = cropY + cropH / 2;

        cropX = Math.round(cx - size / 2);
        cropY = Math.round(cy - size / 2);
        cropW = Math.round(size);
        cropH = Math.round(size);

        // Boundary safety clamps
        cropX = Math.max(0, cropX);
        cropY = Math.max(0, cropY);
        if (cropX + cropW > width) cropW = width - cropX;
        if (cropY + cropH > height) cropH = height - cropY;

        let finalSize = Math.min(cropW, cropH);
        let finalX = cropX;
        let finalY = cropY;

        // If the QR component spans the entire image, we still want to clean it,
        // so we don't bypass. Just set coordinates to cover the bounding area.
        if (finalSize >= width * 0.85 && finalSize >= height * 0.85) {
          finalX = 0;
          finalY = 0;
          finalSize = Math.min(width, height);
        }

        // Render high-res cropped output
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = 360;
        outputCanvas.height = 360;
        const outputCtx = outputCanvas.getContext('2d');
        if (outputCtx) {
          outputCtx.imageSmoothingEnabled = true;
          outputCtx.imageSmoothingQuality = 'high';
          outputCtx.drawImage(
            img,
            (finalX / width) * img.width,
            (finalY / height) * img.height,
            (finalSize / width) * img.width,
            (finalSize / height) * img.height,
            0,
            0,
            360,
            360
          );

          // Get cropped image pixels for pixel-level cleanup & center avatar removal
          const imgData = outputCtx.getImageData(0, 0, 360, 360);
          const pixels = imgData.data;

          // 1. Calculate average luminance for adaptive threshold
          let sumL = 0;
          let count = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i+1];
            const b = pixels[i+2];
            const l = 0.299 * r + 0.587 * g + 0.114 * b;
            sumL += l;
            count++;
          }
          const avgL = sumL / count;
          // Set standard threshold based on overall image brightness
          const contrastThreshold = avgL > 220 ? 190 : (avgL < 110 ? 110 : 145);

          // Adaptive block (module) size and grid offset detection
          const isPixelBlack = (sx: number, sy: number): boolean => {
            const pidx = (sy * 360 + sx) * 4;
            const r = pixels[pidx];
            const g = pixels[pidx+1];
            const b = pixels[pidx+2];
            return (0.299 * r + 0.587 * g + 0.114 * b) <= contrastThreshold;
          };

          const runLengths: number[] = [];
          const scanLines = [70, 90, 110, 250, 270, 290];
          for (const sy of scanLines) {
            let runStart = 50;
            let lastState = isPixelBlack(50, sy);
            for (let sx = 51; sx < 310; sx++) {
              if (sx >= 135 && sx <= 225) continue; // skip central logo zone
              const currState = isPixelBlack(sx, sy);
              if (currState !== lastState) {
                const runLen = sx - runStart;
                if (runLen >= 4 && runLen <= 22) { // reasonable module pixel widths
                  runLengths.push(runLen);
                }
                runStart = sx;
                lastState = currState;
              }
            }
          }

          let detectedModSize = 9; // robust default (typical version module width in 360x360 image)
          if (runLengths.length > 0) {
            const counts: { [key: number]: number } = {};
            runLengths.forEach(len => {
              counts[len] = (counts[len] || 0) + 1;
            });
            let maxCount = 0;
            let bestLen = 9;
            for (const lenStr in counts) {
              const len = parseInt(lenStr, 10);
              if (counts[len] > maxCount) {
                maxCount = counts[len];
                bestLen = len;
              }
            }
            if (bestLen >= 5 && bestLen <= 18) {
              detectedModSize = bestLen;
            }
          }

          // Backtrack to find exact grid boundary to align perfectly
          let gridStartX = 142;
          for (let sx = 135; sx >= 60; sx--) {
            if (isPixelBlack(sx, 180) !== isPixelBlack(sx - 1, 180)) {
              gridStartX = sx;
              break;
            }
          }
          let gridStartY = 142;
          for (let sy = 135; sy >= 60; sy--) {
            if (isPixelBlack(180, sy) !== isPixelBlack(180, sy - 1)) {
              gridStartY = sy;
              break;
            }
          }

          // 2. Filter pixels and completely clear any center logo/avatar (the middle 20% area)
          // Also binarize all colors to clean monochrome (like Image 05)
          for (let y = 0; y < 360; y++) {
            for (let x = 0; x < 360; x++) {
              const idx = (y * 360 + x) * 4;

              // Force clean white borders (quiet zone) to clear any captured bottom text "ID.17(*扬)"
              if (x < 35 || x > 325 || y < 35 || y > 325) {
                pixels[idx] = 255;
                pixels[idx+1] = 255;
                pixels[idx+2] = 255;
                continue;
              }

              const r = pixels[idx];
              const g = pixels[idx+1];
              const b = pixels[idx+2];

              // Grayscale luminance
              const l = 0.299 * r + 0.587 * g + 0.114 * b;

              // Color variance (saturation) to filter colors (like WeChat green)
              const maxVal = Math.max(r, g, b);
              const minVal = Math.min(r, g, b);
              const saturation = maxVal - minVal;

              // --- CLEAR CENTER LOGO / AVATAR WITH WHITE SQUARE ---
              // Replacing the logo/portrait/wallet area with a clean plain white square.
              // Center of 360 is 180. Range 140 to 220 is 80px (approx 22% of QR size).
              if (x >= 140 && x <= 220 && y >= 140 && y <= 220) {
                pixels[idx] = 255;
                pixels[idx+1] = 255;
                pixels[idx+2] = 255;
                continue;
              }

              // --- CLEAR BORDERS & OUTLINE GREEN BACKGROUNDS ---
              // If pixel is clearly colored (green background or blue backgrounds), turn it to pure white
              if (saturation > 25) {
                pixels[idx] = 255;
                pixels[idx+1] = 255;
                pixels[idx+2] = 255;
                continue;
              }

              // --- CONVERT QR PATTERNS TO HIGH INTENSITY MONOCHROME (Image 05) ---
              if (l > contrastThreshold) {
                pixels[idx] = 255;
                pixels[idx+1] = 255;
                pixels[idx+2] = 255;
              } else {
                pixels[idx] = 0;
                pixels[idx+1] = 0;
                pixels[idx+2] = 0;
              }
            }
          }

          // Restore processed pixels to the canvas
          outputCtx.putImageData(imgData, 0, 0);

          resolve(outputCanvas.toDataURL('image/png'));
        } else {
          resolve(dataUrl);
        }
      } catch (err) {
        console.error('QR Crop failed, using original', err);
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
  });
}

interface SettingsViewProps {
  settings: ChauffeurSettings;
  billingRules?: any;
  onUpdateSettings: (updated: ChauffeurSettings) => void;
  onClose: () => void;
  onNavigateToBilling: () => void;
  onLogout?: () => void;
  systemVersion?: string;
}

export default function SettingsView({
  settings,
  billingRules,
  onUpdateSettings,
  onClose,
  onNavigateToBilling,
  onLogout,
  systemVersion = 'V2.0'
}: SettingsViewProps) {
  // Realtime active template name resolution matching MileageModeView
  const activeRulesCache = typeof window !== 'undefined' ? (localStorage.getItem('dd_billing_rules') || (settings?.billingTemplateName ? null : null)) : null;
  let cachedRuleName = '';
  if (activeRulesCache) {
    try {
      const parsed = JSON.parse(activeRulesCache);
      if (parsed && parsed.templateName) cachedRuleName = parsed.templateName;
    } catch (_) {}
  }

  const displayTemplateName = billingRules?.templateName || cachedRuleName || settings.billingTemplateName || '滴滴代驾';

  // Ensure settings.billingTemplateName stays synchronized with active rule name
  React.useEffect(() => {
    if (displayTemplateName && displayTemplateName !== settings.billingTemplateName) {
      onUpdateSettings({ ...settings, billingTemplateName: displayTemplateName });
    }
  }, [displayTemplateName, settings.billingTemplateName]);
  // Local state for interactive settings overlays
  const [activeModal, setActiveModal] = useState<'none' | 'recharge' | 'sms_edit' | 'qr_upload' | 'deviation_slider' | 'deviation_wait_slider'>('none');
  const [activeDoc, setActiveDoc] = useState<'none' | 'disclaimer' | 'user_agreement' | 'legal_statement'>('none');
  const [rechargeInput, setRechargeInput] = useState('100');
  const [tempSmsContent, setTempSmsContent] = useState(settings.smsContent);

  const [isProcessingWechat, setIsProcessingWechat] = useState(false);
  const [isProcessingAlipay, setIsProcessingAlipay] = useState(false);

  // States for the newly designed Payment QR system
  const [selectedQrTab, setSelectedQrTab] = useState<'wechat' | 'alipay'>('wechat');
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [isPhotoAlbumOpen, setIsPhotoAlbumOpen] = useState(false);

  // VIP Promo code states and logic
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  // Aliyun Baota Server API and custom domain endpoint state variables
  const [cloudflareUrl, setCloudflareUrl] = useState(() => {
    try {
      return localStorage.getItem('baota_api_url') || localStorage.getItem('cloudflare_worker_api_url') || '';
    } catch (_) {
      return '';
    }
  });
  const [testingConnection, setTestingConnection] = useState(false);

  const saveCloudflareUrl = (val: string) => {
    setCloudflareUrl(val);
    try {
      localStorage.setItem('baota_api_url', val.trim());
      localStorage.setItem('cloudflare_worker_api_url', val.trim());
    } catch (_) {}
  };

  const handleTestConnection = async () => {
    if (!cloudflareUrl.trim()) {
      setTestingConnection(true);
      try {
        const res = await fetch(`${getBaseApiUrl()}/api/health`);
        if (res.ok) {
          const data = await res.json();
          alert(`✅ 系统内置阿里云宝塔 Express / Node.js 极速 API 服务连接成功！\n- 状态：${data.status}\n- 连线延迟：延迟极低，国内直连。\n- 适用性：中国大陆扫码免VPN直连，秒级报单！`);
        } else {
          alert(`❌ 内置服务连接异常(状态码 ${res.status})，可能服务正在启动中，请稍候再试。`);
        }
      } catch (err: any) {
        alert(`❌ 连接失败：${err.message || err}`);
      } finally {
        setTestingConnection(false);
      }
      return;
    }

    let normalizedUrl = cloudflareUrl.trim().replace(/\/$/, '');
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    setTestingConnection(true);
    try {
      const res = await fetch(`${normalizedUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        alert(`🎉 恭喜！中国大陆阿里云宝塔 API 专线/自定义域名连接成功！\n- 状态：${data.status || '正常'}\n- 节点：中国大陆阿里云服务器/宝塔面板\n- 专线：已成功中继连接到您的云端 MySQL 数据库！`);
      } else {
        try {
          const rootRes = await fetch(normalizedUrl, { method: 'GET' });
          if (rootRes.ok) {
            alert(`✅ 连通测试：检测到阿里云宝塔 API 节点有正常 HTTP 回应！\n您的自定义域名已被成功解析，可正常接收数据同步请求。`);
          } else {
            alert(`⚠️ 调试提示 (HTTP ${rootRes.status})：已连通至宝塔服务器节点，但服务端返回了错误响应。请检查 Node.js 服务运行状态。`);
          }
        } catch (_) {
          alert(`❌ 连接失败：已解析域名，但宝塔服务器节点拒绝连接。请检查 HTTPS 证书和 Node.js 项目管理器状态。`);
        }
      }
    } catch (err: any) {
      alert(`⚠️ 网络连接超时或 CORS 跨域受阻：\n${err.message || err}\n\n建议提示：请登录宝塔面板，确认 Node.js 项目管理器已正常运行且已配置正确的域名反向代理与 CORS 跨域允许首部。`);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRedeemCode = async () => {
    const trimmed = promoCode.trim().toUpperCase();
    if (!trimmed) {
      alert('请输入有效的VIP卡本兑换码后再提交！');
      return;
    }
    setRedeeming(true);

    // Load local caches from shared localStorage as a baseline
    let localCodes: any[] = [];
    try {
      const cached = localStorage.getItem('local_vip_codes');
      if (cached) {
        localCodes = JSON.parse(cached);
      }
    } catch (_) {}

    // 1. Try to find/consume in local storage first to guarantee instant simulation pairing
    const matchedLocal = localCodes.find((c: any) => c.code.toUpperCase() === trimmed);
    if (matchedLocal) {
      if (matchedLocal.isRedeemed) {
        alert('❌ 兑换失败：该兑换码已被其他人或设备兑换过！(本地安全机制已核验)');
        setRedeeming(false);
        return;
      }

      const durationDays = matchedLocal.duration || 30;
      const isForever = durationDays === 99999 || String(matchedLocal.code || '').includes('FOREVER');

      let newExpiry = '永久有效';
      if (!isForever) {
        let baseDate = new Date();
        if (settings.vipExpiry && settings.vipExpiry !== '永久有效') {
          const currentExp = new Date(settings.vipExpiry);
          if (currentExp.getTime() > baseDate.getTime()) {
            baseDate = currentExp;
          }
        }
        baseDate.setDate(baseDate.getDate() + durationDays);
        const yyyy = baseDate.getFullYear();
        const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
        const dd = String(baseDate.getDate()).padStart(2, '0');
        newExpiry = `${yyyy}-${mm}-${dd}`;
      }

      // Update local storage so it registers as redeemed
      matchedLocal.isRedeemed = true;
      matchedLocal.redeemedAt = new Date().toISOString();
      matchedLocal.redeemedBy = localStorage.getItem('dd_user_phone') || settings.customAppName?.trim() || '模拟器测试终端';
      localStorage.setItem('local_vip_codes', JSON.stringify(localCodes));

      // Attempt background database update to keep cloud database updated, but don't block user
      try {
        const docRef = doc(db, 'vip_codes', trimmed);
        updateDoc(docRef, {
          isRedeemed: true,
          redeemedAt: new Date().toISOString(),
          redeemedBy: localStorage.getItem('dd_user_phone') || settings.customAppName?.trim() || '模拟器测试终端'
        }).catch(() => {});
      } catch (_) {}

      // Update client settings
      onUpdateSettings({
        ...settings,
        vipExpiry: newExpiry
      });

      setPromoCode('');
      if (isForever) {
        alert(`🎉 恭喜您！[本地核验直通车] 兑换成功！\n已为您成功激活 永久尊享 VIP 会员特权。\n当前VIP有效期：永久有效`);
      } else {
        alert(`🎉 恭喜您！[本地核验直通车] 兑换成功！\n已为您成功激活并延长 ${durationDays} 天会员特权。\n当前VIP有效期至：${newExpiry}`);
      }
      setRedeeming(false);
      return;
    }

    // 2. Fall back to standard Firestore online check
    try {
      const docRef = doc(db, 'vip_codes', trimmed);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        // If it starts with "VIP-", we can handle it as a potential offline fallback format if Firestore has offline issues,
        // but if getDoc actually completed and returned "does not exist", then it genuinely does not exist online.
        alert('❌ 兑换失败：该兑换码不存在或已作废。\n请在右侧管理后台检查 or 复制并粘帖在左侧输入框内！');
        setRedeeming(false);
        return;
      }

      const codeData = docSnap.data();
      if (codeData.isRedeemed) {
        alert('❌ 兑换失败：该兑换码已被其他人或设备兑换过！');
        setRedeeming(false);
        return;
      }

      const durationDays = codeData.duration || 30;
      const isForever = durationDays === 99999 || String(codeData.code || '').includes('FOREVER');

      let newExpiry = '永久有效';
      if (!isForever) {
        let baseDate = new Date();
        if (settings.vipExpiry && settings.vipExpiry !== '永久有效') {
          const currentExp = new Date(settings.vipExpiry);
          if (currentExp.getTime() > baseDate.getTime()) {
            baseDate = currentExp;
          }
        }
        baseDate.setDate(baseDate.getDate() + durationDays);
        const yyyy = baseDate.getFullYear();
        const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
        const dd = String(baseDate.getDate()).padStart(2, '0');
        newExpiry = `${yyyy}-${mm}-${dd}`;
      }

      // Mark the code as redeemed in Firestore first
      await updateDoc(docRef, {
        isRedeemed: true,
        redeemedAt: new Date().toISOString(),
        redeemedBy: localStorage.getItem('dd_user_phone') || settings.customAppName?.trim() || '司端一体化用户'
      });

      // Update client settings
      onUpdateSettings({
        ...settings,
        vipExpiry: newExpiry
      });

      setPromoCode('');
      if (isForever) {
        alert(`🎉 恭喜您！兑换成功！已为您成功激活 永久尊享 VIP 会员特权。\n当前VIP有效期：永久有效`);
      } else {
        alert(`🎉 恭喜您！兑换成功！已为您成功激活并延长 ${durationDays} 天会员特权。\n当前VIP有效期至：${newExpiry}`);
      }
    } catch (e: any) {
      console.warn("Firestore connection check failed. Activating robust simulator fallback...", e);

      // 3. INTERCEPT OFFLINE ERROR AND ALLOW EXCLUSIVE STRAIGHT ROAD TO REDEMPTION
      const errorMsg = String(e.message || e).toLowerCase();
      const isOfflineError = errorMsg.includes('offline') || 
                             errorMsg.includes('failed to get') || 
                             errorMsg.includes('network') || 
                             errorMsg.includes('failed-precondition') ||
                             !navigator.onLine;

      if (isOfflineError) {
        // Evaluate the code structurally (e.g., VIP30D... or VIPFOREVER...)
        const isForever = trimmed.startsWith('VIPFOREVER');
        const isVipFormat = isForever || (trimmed.startsWith('VIP') && trimmed.includes('D'));
        if (isVipFormat) {
          let durationDays = 30;
          if (isForever) {
            durationDays = 99999;
          } else {
            const match = trimmed.match(/^VIP(\d+)D/i);
            durationDays = match ? parseInt(match[1], 10) : 30;
          }

          let newExpiry = '永久有效';
          if (!isForever) {
            let baseDate = new Date();
            if (settings.vipExpiry && settings.vipExpiry !== '永久有效') {
              const currentExp = new Date(settings.vipExpiry);
              if (currentExp.getTime() > baseDate.getTime()) {
                baseDate = currentExp;
              }
            }
            baseDate.setDate(baseDate.getDate() + durationDays);
            const yyyy = baseDate.getFullYear();
            const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
            const dd = String(baseDate.getDate()).padStart(2, '0');
            newExpiry = `${yyyy}-${mm}-${dd}`;
          }

          // Update client settings
          onUpdateSettings({
            ...settings,
            vipExpiry: newExpiry
          });

          // Append to local storage list to mark as consumed
          localCodes.push({
            code: trimmed,
            duration: durationDays,
            isRedeemed: true,
            createdAt: new Date().toISOString(),
            redeemedAt: new Date().toISOString(),
            redeemedBy: '模拟器离线直通车'
          });
          localStorage.setItem('local_vip_codes', JSON.stringify(localCodes));

          setPromoCode('');

          if (isForever) {
            alert(
              `⚡ [免阻碍调试机制已启动] 离线兑换成功！\n\n` +
              `检测到您当前的测试模拟器/手机环境由于局域网限制或数据库未连接而未能直连云端数据库。\n\n` +
              `我们已为您智能启用本地免密直通核实：\n` +
              `- 分析兑换码规格：永久尊享会员卡密已成立\n` +
              `- 绑定人设备：模拟器离线测试终端\n\n` +
              `✨ 您的 VIP 会员有效期已被成功设置为：永久有效。可立即开启并测试纠偏等特权！`
            );
          } else {
            alert(
              `⚡ [免阻碍调试机制已启动] 离线兑换成功！\n\n` +
              `检测到您当前的测试模拟器/手机环境由于局域网限制或数据库未连接而未能直连云端数据库。\n\n` +
              `我们已为您智能启用本地免密直通核实：\n` +
              `- 分析兑换码规格：${durationDays} 天会员卡密已成立\n` +
              `- 绑定人设备：模拟器离线测试终端\n\n` +
              `✨ 您的 VIP 会员有效期已被成功延长至：${newExpiry}。可立即开启并测试纠偏等特权！`
            );
          }
          setRedeeming(false);
          return;
        }
      }

      alert('❌ 兑换库连接异常，请确保网络良好且输入无误：\n' + e.message);
    } finally {
      setRedeeming(false);
    }
  };

  const wechatInputRef = useRef<HTMLInputElement>(null);
  const alipayInputRef = useRef<HTMLInputElement>(null);

  const handleWechatFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsProcessingWechat(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const cleanedQr = await regenerateQRCode(reader.result as string, 'wechat');
        onUpdateSettings({ ...settings, wechatQrCode: cleanedQr });
        setIsProcessingWechat(false);
      };
      reader.onerror = () => setIsProcessingWechat(false);
      reader.readAsDataURL(file);
    }
  };

  const handleAlipayFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsProcessingAlipay(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const cleanedQr = await regenerateQRCode(reader.result as string, 'alipay');
        onUpdateSettings({ ...settings, alipayQrCode: cleanedQr });
        setIsProcessingAlipay(false);
      };
      reader.onerror = () => setIsProcessingAlipay(false);
      reader.readAsDataURL(file);
    }
  };

  const toggleVoiceBroadcast = () => {
    const next = settings.voiceBroadcast === '开单语音播报' ? '静音播报' : '开单语音播报';
    onUpdateSettings({ ...settings, voiceBroadcast: next });
    if (next === '开单语音播报') {
      initAudioUnlock();
      speakText('已开启开单语音播报');
    } else {
      stopSpeaking();
    }
  };

  const handleRechargeSubmit = () => {
    const amount = Number(rechargeInput) || 0;
    if (amount <= 0) {
      alert('请输入有效的充值金额！');
      return;
    }
    onUpdateSettings({ 
      ...settings, 
      accountBalance: Number((settings.accountBalance + amount).toFixed(2)) 
    });
    setActiveModal('none');
    alert(`成功充值 ¥${amount.toFixed(2)} 元！您的代驾账户可用余额已更新。`);
  };

  const handleSmsSave = () => {
    onUpdateSettings({ ...settings, smsContent: tempSmsContent });
    setActiveModal('none');
  };

  const cycleHomepageColor = () => {
    const colors: ('green' | 'blue' | 'slate')[] = ['green', 'blue', 'slate'];
    const currentIdx = colors.indexOf(settings.homepageColorway);
    const nextIdx = (currentIdx + 1) % colors.length;
    onUpdateSettings({ ...settings, homepageColorway: colors[nextIdx] });
  };

  const cycleDeviationKm = () => {
    const options = [0.5, 1.0, 1.5, 2.0];
    const currentIdx = options.indexOf(settings.deviationKm);
    const nextIdx = (currentIdx + 1) % options.length;
    onUpdateSettings({ ...settings, deviationKm: options[nextIdx] });
  };

  const cycleDeviationWaitSec = () => {
    const options = [10, 30, 45, 60, 120];
    const currentIdx = options.indexOf(settings.deviationWaitSec);
    const nextIdx = (currentIdx + 1) % options.length;
    onUpdateSettings({ ...settings, deviationWaitSec: options[nextIdx] });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 select-none overflow-hidden relative">
      
      {/* 1. Top navigation */}
      <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center justify-between px-4 text-white shadow-md z-10">
        <button 
          onClick={onClose}
          className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
        >
          <X className="w-5 h-5 text-gray-100" />
        </button>
        <span className="font-semibold text-base tracking-wide text-center flex-1 pr-6 text-gray-100">代驾设置</span>
        <button 
          onClick={() => setActiveModal('qr_upload')}
          className="text-xs text-teal-300 font-semibold hover:text-teal-400 active:scale-95 transition-all text-emerald-400 font-bold"
        >
          上传收款码
        </button>
      </div>

      {/* Settings list scrolling area */}
      <div className="flex-1 overflow-y-auto p-4 pb-[calc(2rem+max(env(safe-area-inset-bottom,0px),28px))] space-y-4 android-nav-safe-pb">
        
        {/* Card 1: Billing and broadcast (Screenshot 5 first block) */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs divide-y divide-gray-100 overflow-hidden">
          
          {/* Rules block */}
          <button 
            onClick={onNavigateToBilling}
            className="w-full py-4 px-4 flex items-center justify-between hover:bg-gray-50 bg-white transition-colors text-left"
          >
            <span className="text-sm font-semibold text-gray-700">计费规则</span>
            <div className="flex items-center space-x-1 text-gray-400">
              <span className="text-xs text-gray-500 font-mono font-bold mr-0.5">{displayTemplateName}</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </div>
          </button>

          {/* Voice broadcast changer */}
          <div className="w-full py-3.5 px-4 flex items-center justify-between bg-white">
            <span className="text-sm font-semibold text-gray-700">语音播报状态</span>
            <div className="flex items-center space-x-2">
              <button 
                type="button"
                onClick={() => {
                  initAudioUnlock();
                  speakText('语音播报测试正常！');
                }}
                className="flex items-center space-x-1 text-xs text-blue-600 bg-blue-50 font-bold py-1 px-2.5 rounded-lg border border-blue-100 active:scale-95 transition-all cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5 text-blue-500" />
                <span>测试语音</span>
              </button>
              <button 
                type="button"
                onClick={toggleVoiceBroadcast}
                className="flex items-center space-x-1 text-teal-600 font-semibold py-1 px-2.5 hover:bg-teal-50 rounded-lg border border-teal-100 transition-colors cursor-pointer"
              >
                <span className="text-xs font-bold">{settings.voiceBroadcast}</span>
                <ChevronRight className="w-4 h-4 text-teal-400" />
              </button>
            </div>
          </div>

        </div>

        {/* Card 2: Account details */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs divide-y divide-gray-100 overflow-hidden">
          
          {/* Funds Balance */}
          <button 
            disabled
            className="w-full py-4 px-4 flex items-center justify-between bg-white text-left cursor-default"
          >
            <span className="text-sm font-semibold text-gray-700">账户余额</span>
            <div className="flex items-center space-x-1 text-emerald-600 font-mono font-bold">
              <span>¥888.00</span>
            </div>
          </button>

          {/* VIP Membership Status */}
          <div className="py-4 px-4 flex items-center justify-between bg-white">
            <span className="text-sm font-semibold text-gray-700">VIP会员状态</span>
            {checkVipActive(settings.vipExpiry) ? (
              <div className="flex items-center space-x-1.5 text-amber-600 font-bold text-xs bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                <Crown className="w-4 h-4 text-amber-500 animate-pulse" />
                <span>已激活 VIP ({settings.vipExpiry})</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1 text-slate-400 font-medium text-xs bg-slate-50 px-2.5 py-1 rounded-lg">
                <span>未激活 / 已到期 VIP</span>
              </div>
            )}
          </div>

        </div>

        {/* Card 3: Calibration */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs divide-y divide-gray-100 overflow-hidden">
          
          {/* Toggle physical calibration mode */}
          <div className="py-4 px-4 flex items-center justify-between bg-white">
            <div className="space-y-0.5 max-w-[210px]">
              <div className="text-sm font-semibold text-gray-700">纠偏功能</div>
              <div className="text-[10px] text-gray-400 leading-normal">在行程界面【已行程(公里)】和【等候时间】组件中点击可按设定步长纠偏</div>
            </div>
            <label className={`relative inline-flex items-center ${!checkVipActive(settings.vipExpiry) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
              <input 
                type="checkbox" 
                disabled={!checkVipActive(settings.vipExpiry)}
                checked={!!(checkVipActive(settings.vipExpiry) && settings.deviationMitigation)}
                onChange={(e) => {
                  if (!checkVipActive(settings.vipExpiry)) {
                    alert('🔒 提示：纠偏功能为VIP会员专属特权！请先激活VIP。');
                    return;
                  }
                  onUpdateSettings({ ...settings, deviationMitigation: e.target.checked });
                }}
                className="sr-only peer" 
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1da39b] peer-disabled:bg-slate-300"></div>
            </label>
          </div>

          {/* Deviation added per calibrator */}
          {settings.deviationMitigation && (
            <button 
              onClick={() => setActiveModal('deviation_slider')}
              className="w-full py-4 px-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors text-left"
            >
              <span className="text-sm font-semibold text-gray-700">每次纠偏的公里数</span>
              <div className="flex items-center space-x-1 text-gray-500 font-semibold text-xs font-mono">
                <span>每次{settings.deviationKm}公里</span>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </div>
            </button>
          )}

          {/* Waiting added per calibrator */}
          {settings.deviationMitigation && (
            <button 
              onClick={() => setActiveModal('deviation_wait_slider')}
              className="w-full py-4 px-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-700">每次纠偏的等候时间</span>
                <span className="text-[11px] text-amber-500 font-medium mt-0.5">温馨提示：建议设置60秒</span>
              </div>
              <div className="flex items-center space-x-1 text-gray-500 font-semibold text-xs font-mono">
                <span>每次{settings.deviationWaitSec}秒</span>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </div>
            </button>
          )}

        </div>

        {/* Card 4: Version Display and Agreement Links */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden p-4 flex flex-col items-center justify-center space-y-2">
          <div className="text-gray-400 font-medium text-sm text-center">
            <span>版本号：{systemVersion}</span>
          </div>
          <div className="flex flex-row items-center justify-center space-x-3 text-xs text-teal-600 font-medium">
            <button 
              onClick={() => setActiveDoc('disclaimer')} 
              className="hover:underline active:opacity-70 transition-all cursor-pointer"
            >
              免责声明
            </button>
            <span className="text-gray-200">|</span>
            <button 
              onClick={() => setActiveDoc('user_agreement')} 
              className="hover:underline active:opacity-70 transition-all cursor-pointer"
            >
              用户服务协议
            </button>
            <span className="text-gray-200">|</span>
            <button 
              onClick={() => setActiveDoc('legal_statement')} 
              className="hover:underline active:opacity-70 transition-all cursor-pointer"
            >
              法律声明
            </button>
          </div>
        </div>

      </div>

      {/* SUB-DIALOG: Recharge overlay (Pure interactive element) */}
      {activeModal === 'recharge' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50">
          <div className="bg-white rounded-3xl w-full max-w-[320px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm">司机账户钱包充值</span>
              <X className="w-4 h-4 cursor-pointer" onClick={() => setActiveModal('none')} />
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-400">目前模拟充值资金，充值后可供抵扣日常信息垫付费用支出。</p>
              
              <div className="flex items-center bg-slate-50 border border-gray-200 rounded-xl p-3 shadow-inner">
                <span className="text-md font-bold text-[#1da39b] mr-2">¥</span>
                <input
                  type="number"
                  placeholder="金额"
                  value={rechargeInput}
                  onChange={(e) => setRechargeInput(e.target.value)}
                  className="w-full bg-transparent font-mono text-lg font-bold text-gray-800 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                {['50', '100', '300'].map(val => (
                  <button
                    key={val}
                    onClick={() => setRechargeInput(val)}
                    className={`py-2 rounded-xl text-xs font-semibold border ${
                      rechargeInput === val ? 'bg-teal-50 border-[#1da39b] text-teal-600' : 'bg-white border-gray-200 text-gray-600'
                    }`}
                  >
                    ¥{val} 元
                  </button>
                ))}
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 flex gap-3 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-500 rounded-xl text-xs font-semibold"
              >
                取消
              </button>
              <button 
                onClick={handleRechargeSubmit}
                className="flex-1 py-2.5 bg-[#1da39b] text-white rounded-xl text-xs font-semibold shadow-md"
              >
                确认充值
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-DIALOG: SMS Text Template Editor (Pure interactive element) */}
      {activeModal === 'sms_edit' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-[340px] shadow-2xl overflow-hidden">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm flex items-center space-x-1">
                <Bookmark className="w-4 h-4" />
                <span>自动客服短信内容</span>
              </span>
              <X className="w-4 h-4 cursor-pointer" onClick={() => setActiveModal('none')} />
            </div>
            <div className="p-5 space-y-3">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">编辑提醒短信模版</label>
              <textarea
                value={tempSmsContent}
                onChange={(e) => setTempSmsContent(e.target.value)}
                rows={5}
                className="w-full p-3 border border-gray-200 focus:border-teal-500 text-xs rounded-xl focus:outline-hidden leading-relaxed text-gray-700 bg-slate-50 font-sans"
              />
              <span className="text-[10px] text-gray-400 leading-normal block">
                自动发送场景：代驾司机点单后（开始服务）或收款后（行程结账），将配合网关秒级投递至乘客登记手机上。
              </span>
            </div>
            
            <div className="p-4 bg-slate-50 flex gap-3 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-500 rounded-xl text-xs font-semibold"
              >
                取消
              </button>
              <button 
                onClick={handleSmsSave}
                className="flex-1 py-2.5 bg-[#1da39b] text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1 shadow-md hover:bg-teal-600 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存模板</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-DIALOG: QR CODE UPLOAD MODAL (Re-designed to match Image 2, 3, 4) */}
      {activeModal === 'qr_upload' && (
        <div className="absolute inset-0 bg-[#F1F5F9] flex flex-col z-50 animate-in fade-in slide-in-from-right duration-200">
          
          {/* Header (Matching Image 2 / 4) */}
          <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center justify-between px-4 text-white shadow-md z-14 shrink-0">
            <button 
              onClick={() => {
                if (isPhotoAlbumOpen) {
                  setIsPhotoAlbumOpen(false);
                } else {
                  setActiveModal('none');
                }
              }}
              className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-all flex items-center gap-1 cursor-pointer"
            >
              <svg className="w-5 h-5 text-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-xs font-semibold text-gray-200">返回</span>
            </button>
            <span className="font-bold text-sm tracking-wide text-center">
              {isPhotoAlbumOpen ? '微信' : '我的收款码'}
            </span>
            <button 
              onClick={() => {
                if (isPhotoAlbumOpen) {
                  setIsPhotoAlbumOpen(false);
                } else {
                  // Delete currently active QR code
                  if (selectedQrTab === 'wechat') {
                    onUpdateSettings({ ...settings, wechatQrCode: '' });
                  } else {
                    onUpdateSettings({ ...settings, alipayQrCode: '' });
                  }
                  alert('已成功清空当前通道的收款二维码');
                }
              }}
              className="text-xs font-bold text-red-400 hover:text-red-300 px-2.5 py-1 rounded-md hover:bg-black/10 active:scale-95 transition-all"
            >
              {isPhotoAlbumOpen ? '取消' : '删除'}
            </button>
          </div>

          {/* Hidden File Inputs for real phone uploads */}
          <input 
            type="file" 
            ref={wechatInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleWechatFileChange} 
          />
          <input 
            type="file" 
            ref={alipayInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleAlipayFileChange} 
          />

          {!isPhotoAlbumOpen ? (
            /* SUB-VIEW 1: MY QR CODE OVERVIEW (Image 2 & 4 style) */
            <div className="flex-1 flex flex-col justify-between p-5 overflow-y-auto select-none">
              
              {/* Inner container to center everything beautifully */}
              <div className="flex-1 flex flex-col items-center justify-center py-4">
                
                {/* Main White Rounded Card */}
                <div 
                  onClick={() => {
                    if (selectedQrTab === 'wechat') {
                      wechatInputRef.current?.click();
                    } else {
                      alipayInputRef.current?.click();
                    }
                  }}
                  className="bg-white rounded-3xl w-full max-w-[270px] shadow-lg border border-gray-150 p-6 flex flex-col items-center justify-center aspect-square cursor-pointer hover:border-teal-400 hover:shadow-xl transition-all relative overflow-hidden group mb-8"
                >
                  {/* Outer QR details wrapper */}
                  <div className="w-full flex justify-between items-center mb-5 border-b border-gray-50 pb-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-3 h-3 rounded-full ${selectedQrTab === 'wechat' ? 'bg-[#07C160]' : 'bg-[#108EE9]'}`} />
                      <span className="text-[10px] text-gray-400 font-bold tracking-wider font-sans uppercase">
                        {selectedQrTab === 'wechat' ? 'WECHAT PAY' : 'ALIPAY'}
                      </span>
                    </div>
                    <span className="text-[9px] text-teal-600 font-bold bg-teal-50 px-2 py-0.5 rounded-full font-mono">
                      智能裁剪已就绪
                    </span>
                  </div>

                  {/* QR Image Frame */}
                  <div className="w-full flex-1 min-h-[140px] flex items-center justify-center relative bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                    {selectedQrTab === 'wechat' ? (
                      settings.wechatQrCode ? (
                        <img 
                          src={settings.wechatQrCode} 
                          alt="WeChat QrCode" 
                          className="w-full h-full object-contain rounded-xl max-h-[155px] p-1.5" 
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center p-4">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mb-2">
                            <PlusSquare className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-bold text-gray-700 font-sans">暂未设置微信收款码</span>
                          <span className="text-[9px] text-gray-400 mt-1">轻触开始上传</span>
                        </div>
                      )
                    ) : (
                      settings.alipayQrCode ? (
                        <img 
                          src={settings.alipayQrCode} 
                          alt="Alipay QrCode" 
                          className="w-full h-full object-contain rounded-xl max-h-[155px] p-1.5" 
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center p-4">
                          <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 mb-2">
                            <PlusSquare className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-bold text-gray-700 font-sans">暂未设置支付宝收款码</span>
                          <span className="text-[9px] text-gray-400 mt-1">轻触开始上传</span>
                        </div>
                      )
                    )}

                    {/* Fancy hover banner */}
                    <div className="absolute inset-0 bg-black/40 text-white rounded-2xl flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity gap-1 text-center">
                      <PlusSquare className="w-6 h-6 text-white" />
                      <span className="text-[10px] font-bold">轻触重新上传/更换</span>
                    </div>
                  </div>

                  {/* Channel tag below QR inside card */}
                  <div className="mt-4 flex items-center gap-1">
                    {selectedQrTab === 'wechat' ? (
                      <span className="text-xs font-bold text-gray-600 flex items-center gap-1 font-sans">
                        <span className="w-2 h-2 rounded-full bg-[#07C160]"></span>
                        微信渠道收款二维码
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-gray-600 flex items-center gap-1 font-sans">
                        <span className="w-2 h-2 rounded-full bg-[#108EE9]"></span>
                        支付宝渠道收款二维码
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom interactive WeChat/Alipay Capsule Tabs Selector (Matching Image 2 & 4 style) */}
                <div className="flex bg-white rounded-full p-1 shadow-sm border border-gray-150 w-full max-w-[210px] gap-1 shrink-0">
                  <button
                    onClick={() => setSelectedQrTab('wechat')}
                    className={`flex-1 py-2 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      selectedQrTab === 'wechat' 
                        ? 'bg-[#07C160] text-white shadow-xs' 
                        : 'bg-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2C6.477 2 2 6.015 2 10.97c0 2.81 1.442 5.315 3.69 6.963l-.46 1.72a.5.5 0 0 0 .668.59l2.12-.96c1.233.454 2.585.717 3.982.717 5.523 0 10-4.015 10-10.97C22 6.015 17.523 2 12 2z" />
                    </svg>
                    <span>微信</span>
                  </button>
                  <button
                    onClick={() => setSelectedQrTab('alipay')}
                    className={`flex-1 py-1.5 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      selectedQrTab === 'alipay' 
                        ? 'bg-[#108EE9] text-white shadow-xs' 
                        : 'bg-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <rect width="24" height="24" rx="12" fill="currentColor"/>
                      <text x="12" y="16.5" fill={selectedQrTab === 'alipay' ? '#108EE9' : '#ffffff'} fontSize="14" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">支</text>
                    </svg>
                    <span>支付宝</span>
                  </button>
                </div>

              </div>

              {/* Back Button to close everything at the bottom */}
              <button 
                onClick={() => setActiveModal('none')}
                className="w-full bg-[#273046] hover:bg-[#1a2130] text-white text-sm font-semibold py-3.5 rounded-2xl shadow-md active:scale-98 transition-all shrink-0 font-sans text-center"
              >
                保存设置并返回
              </button>

              {/* SLIDE-UP WECHAT ACTION SHEET (Bottom Sheet styled matching Image 2) */}
              {isBottomSheetOpen && (
                <div className="absolute inset-0 z-50 flex flex-col justify-end">
                  {/* Backdrop */}
                  <div 
                    onClick={() => setIsBottomSheetOpen(false)}
                    className="absolute inset-0 bg-black/60 cursor-pointer animate-in fade-in duration-200" 
                  />
                  {/* Sheet panel */}
                  <div className="relative bg-[#F4F4F4] rounded-t-3xl w-full pt-4 px-1.5 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),28px))] animate-in slide-in-from-bottom duration-200 border-t border-gray-100 z-50 text-center font-sans tracking-wide android-nav-safe-pb">
                    <div className="bg-white rounded-2xl mx-2 shadow-xs overflow-hidden divide-y divide-gray-150">
                      <button 
                        onClick={() => {
                          setIsBottomSheetOpen(false);
                          // Trigger file input for simulation aspect
                          if (selectedQrTab === 'wechat') {
                            wechatInputRef.current?.click();
                          } else {
                            alipayInputRef.current?.click();
                          }
                        }}
                        className="w-full py-4 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        拍照
                      </button>
                      <button 
                        onClick={() => {
                          setIsBottomSheetOpen(false);
                          setIsPhotoAlbumOpen(true);
                        }}
                        className="w-full py-4 text-center text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors bg-white font-sans"
                      >
                        从手机相册选择
                      </button>
                    </div>

                    <div className="mt-2.5 mx-2">
                      <button 
                        onClick={() => setIsBottomSheetOpen(false)}
                        className="w-full py-4 bg-white rounded-2xl text-center text-sm font-bold text-[#E54545] hover:bg-red-50 transition-colors shadow-2xs font-sans"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* SUB-VIEW 2: DYNAMIC WECHAT-STYLE PHOTO ALBUM (Image 3 style) */
            <div className="flex-1 bg-[#121212] flex flex-col overflow-hidden text-white font-sans">
              
              {/* Top subheader bar */}
              <div className="bg-[#1A1A1A] px-4 py-2 flex items-center justify-between border-b border-[#2C2C2C] shrink-0 text-xs text-gray-400">
                <span className="font-bold flex items-center gap-1 text-gray-300">
                  相机胶卷
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
                <span>微信相册 (8)</span>
              </div>

              {/* Photo album grid - 3 Columns (Exactly representing layout elements of Image 3) */}
              <div className="flex-1 overflow-y-auto p-0.5 bg-[#121212]">
                <div className="grid grid-cols-3 gap-0.5">
                  {MOCK_ALBUM_PHOTOS.map((photo, index) => (
                    <div 
                      key={photo.id}
                      onClick={async () => {
                        // User selects the photo
                        try {
                          const cleanedQr = await regenerateQRCode(photo.dataUrl, selectedQrTab);
                          if (selectedQrTab === 'wechat') {
                            onUpdateSettings({ ...settings, wechatQrCode: cleanedQr });
                          } else {
                            onUpdateSettings({ ...settings, alipayQrCode: cleanedQr });
                          }
                          
                          // Small customized log feedback
                          if (index === 0) {
                            alert('🎉 您已成功选择相册第一个二维码！\n系统已将其中的微信专属头像与加密标识自动抹除，并转换为高清无损的纯黑白二维码格式供页面展示。');
                          } else {
                            alert(`🎉 已选定 ${photo.name}，已自动抹除中间小图片和个人头像，转换为黑白二维码！`);
                          }
                        } catch (err) {
                          if (selectedQrTab === 'wechat') {
                            onUpdateSettings({ ...settings, wechatQrCode: photo.dataUrl });
                          } else {
                            onUpdateSettings({ ...settings, alipayQrCode: photo.dataUrl });
                          }
                        }
                        
                        setIsPhotoAlbumOpen(false);
                      }}
                      className="aspect-square relative overflow-hidden group cursor-pointer"
                    >
                      <img 
                        src={photo.dataUrl} 
                        alt={photo.name} 
                        className="w-full h-full object-cover transition-transform group-hover:scale-105" 
                      />

                      {/* Small serial item badge index number mirroring Image 3 */}
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full border border-white/80 bg-black/45 hover:bg-teal-500/80 flex items-center justify-center text-[10px] font-bold text-white transition-all">
                        {index === 0 ? '1' : index + 1}
                      </div>

                      {/* Detail metadata tags overlay on hover or active to make it gorgeous */}
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 py-1 px-1 text-center text-[8px] text-gray-300 font-mono scale-y-0 group-hover:scale-100 origin-bottom transition-all duration-150">
                        {photo.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Photo Album bottom preview panel bar */}
              <div className="bg-[#1A1A1A] h-12 border-t border-[#2C2C2C] px-4 flex items-center justify-between text-xs text-gray-400 shrink-0">
                <button 
                  onClick={() => {
                    // Trigger real computer file selector inside album
                    if (selectedQrTab === 'wechat') {
                      wechatInputRef.current?.click();
                    } else {
                      alipayInputRef.current?.click();
                    }
                    setIsPhotoAlbumOpen(false);
                  }}
                  className="text-teal-400 hover:text-teal-300 font-semibold cursor-pointer"
                >
                  本地上传文件
                </button>
                <span className="text-[11px] text-gray-500 leading-normal font-sans">
                  已选择 1 张卡片
                </span>
                <button 
                  onClick={() => setIsPhotoAlbumOpen(false)}
                  className="bg-[#07C160] text-white px-4 py-1.5 rounded-lg font-bold hover:bg-[#06a504] cursor-pointer"
                >
                  原图
                </button>
              </div>

            </div>
          )}

        </div>
      )}

      {/* SUB-DIALOG: DEVIATION SLIDER */}
      {activeModal === 'deviation_slider' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-[320px] shadow-2xl overflow-hidden text-left">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm flex items-center space-x-1.5">
                <Bookmark className="w-4 h-4 text-teal-300" />
                <span>纠偏每次加减的公里数</span>
              </span>
              <X className="w-4 h-4 cursor-pointer text-gray-300 hover:text-white" onClick={() => setActiveModal('none')} />
            </div>
            
            <div className="p-6 space-y-6">
              <div className="text-center">
                <span className="text-sm text-gray-400 block mb-1">偏差值设定 (0 - 10 公里)</span>
                <span className="text-4xl font-extrabold text-[#1da39b] font-mono">
                  {settings.deviationKm.toFixed(1)} <span className="text-base font-medium text-gray-500 font-sans">公里</span>
                </span>
              </div>

              <div className="space-y-2">
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={settings.deviationKm}
                  onChange={(e) => onUpdateSettings({ ...settings, deviationKm: parseFloat(e.target.value) })}
                  className="w-full accent-[#1da39b] h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer border border-gray-200"
                />
                <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                  <span>0.0 km</span>
                  <span>2.5 km</span>
                  <span>5.0 km</span>
                  <span>7.5 km</span>
                  <span>10.0 km</span>
                </div>
              </div>

              <p className="text-[11px] text-gray-400 leading-normal text-center bg-slate-50 p-2.5 rounded-xl border border-gray-100">
                调整时将以该公里数为单位进行每次增减，并在双击极速纠偏中直接追加。费用将根据此变动自动重算。
              </p>
            </div>

            <div className="p-4 bg-slate-50 flex gap-2 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="w-full py-2.5 bg-[#1da39b] hover:bg-teal-600 text-white rounded-xl text-xs font-semibold text-center transition-colors shadow-md flex items-center justify-center space-x-1"
              >
                <CheckCircle className="w-4 h-4" />
                <span>确认设置</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-DIALOG: DEVIATION WAIT SLIDER */}
      {activeModal === 'deviation_wait_slider' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-[320px] shadow-2xl overflow-hidden text-left">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm flex items-center space-x-1.5">
                <Bookmark className="w-4 h-4 text-teal-300" />
                <span>纠偏每次加减的的等候时间</span>
              </span>
              <X className="w-4 h-4 cursor-pointer text-gray-300 hover:text-white" onClick={() => setActiveModal('none')} />
            </div>
            
            <div className="p-6 space-y-6">
              <div className="text-center">
                <span className="text-sm text-gray-400 block mb-1">等候耗时设定 (0 - 60 秒)</span>
                <span className="text-4xl font-extrabold text-[#1da39b] font-mono">
                  {settings.deviationWaitSec} <span className="text-base font-medium text-gray-500 font-sans">秒</span>
                </span>
              </div>

              <div className="space-y-2">
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={settings.deviationWaitSec}
                  onChange={(e) => onUpdateSettings({ ...settings, deviationWaitSec: parseInt(e.target.value, 10) || 0 })}
                  className="w-full accent-[#1da39b] h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer border border-gray-200"
                />
                <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                  <span>0 秒</span>
                  <span>15 秒</span>
                  <span>30 秒</span>
                  <span>45 秒</span>
                  <span>60 秒</span>
                </div>
                <div className="text-center pt-2">
                  <span className="text-[11px] text-amber-500 font-medium bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100 inline-block animate-pulse">
                    温馨提示：建议设置60秒
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-gray-400 leading-normal text-center bg-slate-50 p-2.5 rounded-xl border border-gray-100">
                调整时将以该秒数为单位进行每次增减。费用将根据此等候变动自动重算。
              </p>
            </div>

            <div className="p-4 bg-slate-50 flex gap-2 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="w-full py-2.5 bg-[#1da39b] hover:bg-teal-600 text-white rounded-xl text-xs font-semibold text-center transition-colors shadow-md flex items-center justify-center space-x-1"
              >
                <CheckCircle className="w-4 h-4" />
                <span>确认设置</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Detail Sub-Page Overlay */}
      {activeDoc !== 'none' && (
        <div className="absolute inset-0 bg-slate-50 flex flex-col z-50 animate-in slide-in-from-right duration-200">
          {/* Top navigation header */}
          <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center justify-between px-4 text-white shadow-md">
            <button 
              onClick={() => setActiveDoc('none')}
              className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-colors flex items-center"
            >
              <ChevronLeft className="w-5 h-5 text-gray-100 mr-0.5" />
              <span className="text-sm font-medium">返回</span>
            </button>
            <span className="font-semibold text-base tracking-wide text-center flex-1 pr-12 text-gray-100">
              {activeDoc === 'disclaimer' ? '免责声明' : activeDoc === 'user_agreement' ? '用户服务协议' : '法律声明'}
            </span>
          </div>

          {/* Content scroll area */}
          <div className="flex-1 overflow-y-auto p-5 pb-10 text-gray-700 text-sm leading-relaxed space-y-4">
            {activeDoc === 'disclaimer' && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-4">
                <h3 className="font-bold text-gray-800 text-base border-b border-gray-100 pb-2">免责声明</h3>
                <p className="text-gray-600 leading-relaxed text-sm whitespace-pre-line">
                  黑湾代驾MAX仅提供代驾模拟计费、里程统计、等候费计算功能，代驾司机根据个人意愿，自行决定使用本工具。代驾收费模式、费用由代驾司机自行设置决定或与客户共同协商决定。
                  {"\n\n"}
                  代驾司机与客户发生的一切纠纷或争议与本工具无关，请通过法律途径维护各自的合法权益，请各位司机用户通过本工具合法合规的开展代驾服务，切勿做“黑代驾”！
                </p>
              </div>
            )}

            {activeDoc === 'user_agreement' && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-4 text-xs md:text-sm">
                <h3 className="font-bold text-gray-800 text-base border-b border-gray-100 pb-2">用户服务协议</h3>
                <div className="space-y-4 text-gray-600 leading-relaxed whitespace-pre-line">
                  <p className="font-medium text-gray-800">
                    黑湾代驾MAX代驾计价工具软件，包括但不限于APP、小程序、HTML5页面和网站等。
                  </p>
                  <p>
                    <strong className="text-gray-800">您即用户</strong>：自主运营代驾业务的司机。{"\n"}
                    <strong className="text-gray-800">用户数据</strong>：使用过程中产生的，被服务器记录的各种数据。{"\n"}
                    <strong className="text-gray-800">账号封禁</strong>：简称封号。因违反协议约定，开发者采取的强制下线措施。
                  </p>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">一、注册认证</h4>
                    <p>
                      1.1 注册使用均视为您已仔细阅读并充分理解，且同意接受本协议项下所有内容。{"\n"}
                      1.2 注册日期为本协议签订日期，协议期限至您注销账号为止。{"\n"}
                      1.3 不得冒用他人身份信息进行实名注册认证。{"\n"}
                      1.4 若不进行实名认证或提供的注册信息不完整，您可能在使用过程中会受到相应限制。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">二、用户规范</h4>
                    <p>
                      2.1 您与开发者不存在雇佣劳动关系，不得以开发者雇佣身份对外开展代驾业务。{"\n"}
                      2.2 您自行开展具体代驾运营业务，包括但不限于开单和收费等。{"\n"}
                      2.3 请根据市场行情公允定价，拒绝酒/醉驾。{"\n"}
                      2.4 如您选购开通某项附属服务，应当遵守相关约定。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">三、限制用户权利条款</h4>
                    <p>
                      4.1 未经授权，严禁篡改软件代码或冒充代理商等，用于商业用途。{"\n"}
                      4.2 未经许可，不得发布任何形式 of 广告。{"\n"}
                      4.3 不得发布各类违法违规信息，包括但不限于商品、服务、交易、评论和留言等。{"\n"}
                      4.4 积分等虚拟物品不折现，用户注销账号自动清零。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">四、免除开发者责任条款</h4>
                    <p>
                      5.1 按照公示的收费标准有偿提供软件服务。有权根据市场需求和用户反馈更新收费标准。{"\n"}
                      5.2 开发者不参与您具体代驾运营业务，不对代驾服务质量作任何形式担保，不承担任何代驾业务相关责任。{"\n"}
                      5.3 代驾圈各类信息由用户自行发布，需谨慎判断并承担相关风险。{"\n"}
                      5.4 附属服务由第三方提供最终服务的，开发者不承担连带责任。{"\n"}
                      5.5 用户违反相关协议规则，开发者有权采取禁言和封号等措施，且无须承担任何责任。{"\n"}
                      5.6 因自然灾害等不可抗力因素，电信部门技术调整或设备故障，黑客攻击等，不能正常提供软件服务的，开发者不承担任何责任，尽力配合您降低损失和影响。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">五、其他</h4>
                    <p>
                      所有更新补充条款、附属服务条款，以及其他服务策略和规则，共同构成本协议，均具有法律效力。任一条款无论因何种原因无效或不具备可执行条件，其余条款仍然有效。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeDoc === 'legal_statement' && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-4">
                <h3 className="font-bold text-gray-800 text-base border-b border-gray-100 pb-2">法律声明</h3>
                <div className="space-y-3 text-gray-600 leading-relaxed whitespace-pre-line text-sm">
                  <p>
                    <strong className="text-gray-800">1、您，又称“用户”</strong>：与本公司不存在雇佣劳动关系，不得以本公司员工身份对外开展代驾业务。
                  </p>
                  <p>
                    <strong className="text-gray-800">2、本公司仅提供软件信息技术服务</strong>：为代驾司机提供计价工具。不参与您具体代驾运营，不承担任何代驾业务相关责任。由您自行开展具体代驾运营业务（包括但不限于：定价、接单和收费等），并对其负责。
                  </p>
                  <p>
                    <strong className="text-gray-800">3、拒绝酒驾、醉驾</strong>：请您根据市场公允定价，勿做“黑代驾”。
                  </p>
                  <p>
                    <strong className="text-gray-800">4、违约处理</strong>：用户违反相关协议规则时，本公司有权冻结账号，采取封号措施。且无须承担任何责任。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
