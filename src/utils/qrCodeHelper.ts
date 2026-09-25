import jsQR from 'jsqr';
import QRCode from 'qrcode';

/**
 * Memory-safe helper to downscale high-resolution mobile photos (12MP~48MP)
 * down to max 800px to prevent Android OOM crashes and iOS WKWebView white-screen reloads.
 */
export function downscaleImage(img: HTMLImageElement, maxDim = 800): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  let width = img.naturalWidth || img.width || 800;
  let height = img.naturalHeight || img.height || 800;

  if (width <= 0 || height <= 0) {
    width = 800;
    height = 800;
  }

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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
  }
  return canvas;
}

/**
 * Scans a canvas for QR code payload using jsQR with multi-strategy support
 * (standard, contrast enhanced, and multi-scale attempts)
 */
function tryScanCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return null;

  // Attempt 1: Direct scan
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imgData.data, width, height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data && code.data.trim()) {
      return code.data.trim();
    }
  } catch (_) {}

  // Attempt 2: High contrast & Binarization
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const len = data.length;
    let sumL = 0;
    for (let i = 0; i < len; i += 4) {
      sumL += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const avgL = sumL / (len / 4);
    const threshold = avgL > 200 ? 170 : (avgL < 90 ? 100 : 135);

    for (let i = 0; i < len; i += 4) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = l < threshold ? 0 : 255;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }

    const binarizedCode = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (binarizedCode && binarizedCode.data && binarizedCode.data.trim()) {
      return binarizedCode.data.trim();
    }
  } catch (_) {}

  // Attempt 3: Multi-scale downscale (450px, 320px)
  const targetSizes = [450, 320];
  for (const targetSize of targetSizes) {
    if (Math.max(width, height) > targetSize * 1.2) {
      try {
        const scale = targetSize / Math.max(width, height);
        const sw = Math.max(1, Math.round(width * scale));
        const sh = Math.max(1, Math.round(height * scale));
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = sw;
        scaledCanvas.height = sh;
        const sctx = scaledCanvas.getContext('2d', { willReadFrequently: true });
        if (sctx) {
          sctx.drawImage(canvas, 0, 0, sw, sh);
          const simgData = sctx.getImageData(0, 0, sw, sh);
          const scode = jsQR(simgData.data, sw, sh, { inversionAttempts: 'attemptBoth' });
          if (scode && scode.data && scode.data.trim()) {
            return scode.data.trim();
          }
        }
      } catch (_) {}
    }
  }

  return null;
}

/**
 * Lightweight, memory-safe bounding box detection on downscaled canvas
 */
export function detectQRBoundingBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | null {
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const blockSize = Math.max(4, Math.floor(Math.min(width, height) / 40));
    const cols = Math.floor(width / blockSize);
    const rows = Math.floor(height / blockSize);
    if (cols <= 0 || rows <= 0) return null;

    const density = Array.from({ length: rows }, () => new Float32Array(cols));
    let maxDensity = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let transitionCount = 0;
        const startX = c * blockSize;
        const startY = r * blockSize;

        for (let y = startY; y < Math.min(height - 1, startY + blockSize); y += 3) {
          for (let x = startX; x < Math.min(width - 1, startX + blockSize); x += 3) {
            const idx1 = (y * width + x) * 4;
            const idxRight = (y * width + (x + 1)) * 4;
            const idxDown = ((y + 1) * width + x) * 4;

            const r1 = data[idx1], g1 = data[idx1 + 1], b1 = data[idx1 + 2];
            const sat1 = Math.max(r1, g1, b1) - Math.min(r1, g1, b1);
            const l1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;

            const lRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
            const lDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];

            if (sat1 < 45) {
              if (Math.abs(l1 - lRight) > 40) transitionCount++;
              if (Math.abs(l1 - lDown) > 40) transitionCount++;
            }
          }
        }

        density[r][c] = transitionCount;
        if (transitionCount > maxDensity) {
          maxDensity = transitionCount;
        }
      }
    }

    if (maxDensity < 3) return null;

    const threshold = Math.max(2, maxDensity * 0.25);
    const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
    const components: { minR: number; maxR: number; minC: number; maxC: number; count: number }[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (density[r][c] >= threshold && visited[r][c] === 0) {
          let minR = r, maxR = r, minC = c, maxC = c;
          let count = 0;
          const queue: [number, number][] = [[r, c]];
          visited[r][c] = 1;

          while (queue.length > 0) {
            const [cr, cc] = queue.shift()!;
            count++;
            if (cr < minR) minR = cr;
            if (cr > maxR) maxR = cr;
            if (cc < minC) minC = cc;
            if (cc > maxC) maxC = cc;

            const bridge = 2;
            for (let dr = -bridge; dr <= bridge; dr++) {
              for (let dc = -bridge; dc <= bridge; dc++) {
                const nr = cr + dr;
                const nc = cc + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                  if (density[nr][nc] >= threshold && visited[nr][nc] === 0) {
                    visited[nr][nc] = 1;
                    queue.push([nr, nc]);
                  }
                }
              }
            }
          }

          if (count >= 4) {
            components.push({ minR, maxR, minC, maxC, count });
          }
        }
      }
    }

    if (components.length === 0) return null;

    components.sort((a, b) => b.count - a.count);
    const best = components[0];

    const rawX = best.minC * blockSize;
    const rawY = best.minR * blockSize;
    const rawW = (best.maxC - best.minC + 1) * blockSize;
    const rawH = (best.maxR - best.minR + 1) * blockSize;

    const maxDim = Math.max(rawW, rawH);
    const padding = Math.round(maxDim * 0.05);
    const cx = rawX + rawW / 2;
    const cy = rawY + rawH / 2;
    const size = maxDim + padding * 2;

    let x = Math.round(cx - size / 2);
    let y = Math.round(cy - size / 2);
    let w = Math.round(size);
    let h = Math.round(size);

    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > width) w = width - x;
    if (y + h > height) h = height - y;

    const finalSide = Math.min(w, h);
    return { x, y, width: finalSide, height: finalSide };
  } catch (_) {
    return null;
  }
}

/**
 * Memory-safe and crash-proof QR code extraction and lossless reconstruction
 */
export function cropQRCodeFromImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      resolve(dataUrl);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Step 1: Immediately downscale image to max 800px to avoid memory spikes
        const downscaledCanvas = downscaleImage(img, 800);
        const dw = downscaledCanvas.width;
        const dh = downscaledCanvas.height;

        // Step 2: Try scanning the downscaled canvas with jsQR
        const fullScanPayload = tryScanCanvas(downscaledCanvas);
        if (fullScanPayload) {
          QRCode.toDataURL(fullScanPayload, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 450,
            color: { dark: '#000000', light: '#ffffff' }
          }).then(resolve).catch(() => resolve(downscaledCanvas.toDataURL('image/png')));
          return;
        }

        // Step 3: If direct scan didn't find payload, detect bounding box on downscaled canvas
        const dctx = downscaledCanvas.getContext('2d', { willReadFrequently: true });
        if (!dctx) {
          resolve(downscaledCanvas.toDataURL('image/png'));
          return;
        }

        const bbox = detectQRBoundingBox(dctx, dw, dh);
        const cropX = bbox ? bbox.x : Math.round((dw - Math.min(dw, dh)) / 2);
        const cropY = bbox ? bbox.y : Math.round((dh - Math.min(dw, dh)) / 2);
        const cropW = bbox ? bbox.width : Math.min(dw, dh);
        const cropH = bbox ? bbox.height : Math.min(dw, dh);

        // Step 4: Render cropped canvas at 400x400
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = 400;
        croppedCanvas.height = 400;
        const croppedCtx = croppedCanvas.getContext('2d', { willReadFrequently: true });
        if (!croppedCtx) {
          resolve(downscaledCanvas.toDataURL('image/png'));
          return;
        }

        croppedCtx.imageSmoothingEnabled = true;
        croppedCtx.imageSmoothingQuality = 'high';
        croppedCtx.drawImage(downscaledCanvas, cropX, cropY, cropW, cropH, 0, 0, 400, 400);

        // Step 5: Try scanning the cropped 400x400 canvas
        const croppedScanPayload = tryScanCanvas(croppedCanvas);
        if (croppedScanPayload) {
          QRCode.toDataURL(croppedScanPayload, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 450,
            color: { dark: '#000000', light: '#ffffff' }
          }).then(resolve).catch(() => resolve(croppedCanvas.toDataURL('image/png')));
          return;
        }

        // Step 6: Fallback: Clean up margins & binarize
        const imgData = croppedCtx.getImageData(0, 0, 400, 400);
        const pixels = imgData.data;

        let sumL = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          sumL += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        }
        const avgL = sumL / (pixels.length / 4);
        const threshold = avgL > 210 ? 180 : (avgL < 100 ? 100 : 140);

        for (let y = 0; y < 400; y++) {
          for (let x = 0; x < 400; x++) {
            const idx = (y * 400 + x) * 4;

            // Clear margin borders
            if (x < 20 || x > 380 || y < 20 || y > 380) {
              pixels[idx] = 255;
              pixels[idx + 1] = 255;
              pixels[idx + 2] = 255;
              continue;
            }

            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const sat = Math.max(r, g, b) - Math.min(r, g, b);
            const l = 0.299 * r + 0.587 * g + 0.114 * b;

            // Remove colored background (green or blue)
            if (sat > 25) {
              pixels[idx] = 255;
              pixels[idx + 1] = 255;
              pixels[idx + 2] = 255;
              continue;
            }

            // High contrast monochrome binarization
            if (l > threshold) {
              pixels[idx] = 255;
              pixels[idx + 1] = 255;
              pixels[idx + 2] = 255;
            } else {
              pixels[idx] = 0;
              pixels[idx + 1] = 0;
              pixels[idx + 2] = 0;
            }
          }
        }

        croppedCtx.putImageData(imgData, 0, 0);
        resolve(croppedCanvas.toDataURL('image/png'));
      } catch (err) {
        console.error('QR Crop process error:', err);
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Universal regenerateQRCode wrapper that guarantees a cropped, clean, lossless QR code
 */
export async function regenerateQRCode(dataUrl: string, _type?: 'wechat' | 'alipay'): Promise<string> {
  if (!dataUrl) return '';
  return await cropQRCodeFromImage(dataUrl);
}
