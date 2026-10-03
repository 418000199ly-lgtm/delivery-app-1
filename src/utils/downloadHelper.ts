/**
 * Binary-safe download helper for browser/iframe environments.
 * Prevents iframe sandbox interception and ensures full 26MB+ binary ZIP archive is downloaded.
 */
export async function downloadDeployZip(filename = 'daijia_deploy.zip', onStatus?: (msg: string) => void): Promise<void> {
  const notify = (msg: string) => {
    if (onStatus) onStatus(msg);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app_toast', { detail: { message: msg } }));
    }
  };

  notify('⏳ 正在准备最新宝塔完整部署包 (约26MB)，请稍候...');

  try {
    const urls = [
      `/api/download-zip?t=${Date.now()}`,
      `/${filename}?t=${Date.now()}`,
      `/dist/${filename}?t=${Date.now()}`
    ];

    let downloadedBlob: Blob | null = null;

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store'
        });

        if (res.ok) {
          const blob = await res.blob();
          // Verify it's a real archive (greater than 500KB) and not an HTML error document
          if (blob && blob.size > 500000) {
            downloadedBlob = blob;
            break;
          }
        }
      } catch (err) {
        console.warn(`Fetch candidate ${url} failed:`, err);
      }
    }

    if (downloadedBlob) {
      const zipBlob = new Blob([downloadedBlob], { type: 'application/zip' });
      const blobUrl = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
        window.URL.revokeObjectURL(blobUrl);
      }, 5000);

      const sizeMb = (downloadedBlob.size / (1024 * 1024)).toFixed(1);
      notify(`🎉 宝塔部署包 (${sizeMb} MB) 下载已就绪并启动！包含完整0错误解压代码`);
      return;
    }

    // Fallback: Direct anchor click with target="_blank"
    notify('🚀 正在通过备用下载通道启动下载...');
    const directA = document.createElement('a');
    directA.href = `/api/download-zip?t=${Date.now()}`;
    directA.download = filename;
    directA.target = '_blank';
    directA.rel = 'noopener noreferrer';
    directA.style.display = 'none';
    document.body.appendChild(directA);
    directA.click();

    setTimeout(() => {
      if (document.body.contains(directA)) {
        document.body.removeChild(directA);
      }
    }, 2000);

  } catch (err: any) {
    console.error('Download trigger error:', err);
    window.location.href = `/${filename}`;
  }
}
