import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';

// Intercept and gracefully ignore third-party script errors (e.g., from Gaode AMap inside the sandboxed iframe)
// to prevent them from bubbling up as unhandled "Script error." which breaks the app container.
if (typeof window !== 'undefined') {
  window.onerror = function (message, source, lineno, colno, error) {
    const msg = String(message).toLowerCase();
    const srcStr = source ? String(source).toLowerCase() : '';
    const errStack = error && error.stack ? String(error.stack).toLowerCase() : '';
    
    if (
      msg.includes('script error') || 
      msg.includes('network error') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      srcStr.includes('amap') || 
      srcStr.includes('webapi') ||
      errStack.includes('amap')
    ) {
      console.warn('Swallowed cross-origin or third-party script / network error safely:', message, 'Source:', source);
      return true; // Prevents the firing of the default event handler and stops bubbling
    }
    return false;
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason) {
      const reasonStr = String(reason).toLowerCase();
      const reasonStack = reason.stack ? String(reason.stack).toLowerCase() : '';
      if (
        reasonStr.includes('amap') || 
        reasonStr.includes('script error') || 
        reasonStr.includes('network error') ||
        reasonStr.includes('failed to fetch') ||
        reasonStr.includes('networkerror') ||
        reasonStr.includes('aborted') ||
        reasonStack.includes('amap')
      ) {
        console.warn('Swallowed unhandled promise rejection safely:', reason);
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }, true);

  // Lock WeChat & Android WebView text zoom to 100% to prevent layout distortion from system font settings
  const lockFontSize = () => {
    if (typeof (window as any).WeixinJSBridge === 'object' && typeof (window as any).WeixinJSBridge.invoke === 'function') {
      (window as any).WeixinJSBridge.invoke('setFontSizeCallback', { fontSize: 0 });
      (window as any).WeixinJSBridge.on('menu:setfont', () => {
        (window as any).WeixinJSBridge.invoke('setFontSizeCallback', { fontSize: 0 });
      });
    }
  };

  if (typeof (window as any).WeixinJSBridge === 'object') {
    lockFontSize();
  } else {
    document.addEventListener('WeixinJSBridgeReady', lockFontSize, false);
  }

  // Android System Font Size & Display Scaling Calibration Engine
  // Neutralizes Android system font size (小/标准/大/超大) & display size settings
  const calibrateSystemFontScale = () => {
    try {
      const docEl = document.documentElement;
      const dummy = document.createElement('div');
      dummy.style.cssText = 'font-size:16px!important;width:1rem!important;height:1px!important;position:absolute!important;left:-9999px!important;top:-9999px!important;visibility:hidden!important;pointer-events:none!important;';
      (document.body || docEl).appendChild(dummy);
      const computedSize = parseFloat(window.getComputedStyle(dummy).fontSize || '16');
      if (dummy.parentNode) dummy.parentNode.removeChild(dummy);

      if (computedSize && !isNaN(computedSize) && isFinite(computedSize) && computedSize > 5 && computedSize < 40 && Math.abs(computedSize - 16) > 0.05) {
        const scaleFactor = 16 / computedSize;
        if (isFinite(scaleFactor) && scaleFactor >= 0.5 && scaleFactor <= 2.0) {
          docEl.style.setProperty('font-size', `${16 * scaleFactor}px`, 'important');
          return;
        }
      }
      docEl.style.setProperty('font-size', '16px', 'important');
    } catch (e) {
      try {
        document.documentElement.style.setProperty('font-size', '16px', 'important');
      } catch (_) {}
    }
  };

  calibrateSystemFontScale();
  window.addEventListener('resize', calibrateSystemFontScale);
  window.addEventListener('orientationchange', calibrateSystemFontScale);
  window.addEventListener('pageshow', calibrateSystemFontScale);

  // Prevent multi-touch gesture zoom & double-tap zooming on Android
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);


