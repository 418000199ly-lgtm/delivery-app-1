/**
 * Gaode AMap SDK Safe Dynamic Loader
 */
export function ensureAMapLoaded(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not defined'));
  }

  // Pre-configure security code for Gaode AMap JS API v2.0
  (window as any)._AMapSecurityConfig = {
    securityJsCode: '0aa3912e6a88fe59f9e5f0275524feba'
  };

  return new Promise((resolve) => {
    if ((window as any).AMap && (window as any).AMap.Map) {
      resolve((window as any).AMap);
      return;
    }

    const scriptId = 'amap-js-api-v2';
    let script = document.getElementById(scriptId) as HTMLScriptElement || document.querySelector('script[src*="webapi.amap.com"]');

    if (!script) {
      script = document.createElement('script') as HTMLScriptElement;
      script.id = scriptId;
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=4143e567d55bbc1855231f9637efd6b0&plugin=AMap.Geocoder,AMap.Geolocation,AMap.Driving,AMap.AutoComplete,AMap.PlaceSearch,AMap.CitySearch,AMap.GeometryUtil';
      script.async = true;
      document.head.appendChild(script);
    }

    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      if ((window as any).AMap && (window as any).AMap.Map) {
        clearInterval(checkInterval);
        resolve((window as any).AMap);
      } else if (attempts > 120) { // 12 seconds max
        clearInterval(checkInterval);
        resolve((window as any).AMap || null);
      }
    }, 100);
  });
}
