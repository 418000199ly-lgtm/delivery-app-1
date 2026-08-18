/**
 * Binary-safe download helper for browser/iframe environments.
 * Synchronously triggers native browser download to preserve user gesture context.
 */
export function downloadDeployZip(filename = 'daijia_deploy.zip'): void {
  try {
    const downloadUrl = `/${filename}?t=${Date.now()}`;
    
    // Direct anchor click inside user gesture
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 1000);

    // Fallback iframe download trigger for strict sandboxed frames
    setTimeout(() => {
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = downloadUrl;
        document.body.appendChild(iframe);
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 30000);
      } catch (e) {
        console.warn('Iframe download fallback notice:', e);
      }
    }, 500);

  } catch (err) {
    console.error('Download trigger failed, using direct location:', err);
    window.location.href = `/${filename}`;
  }
}

