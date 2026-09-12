import jsQR from 'jsqr';
import QRCode from 'qrcode';

/**
 * Scans a canvas for QR code payload using jsQR with multi-strategy support
 * (standard, multi-scale, and binarized attempts)
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

  // Attempt 2: Grayscale & Contrast Binarization
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    // Calculate average luminance
    let sumL = 0;
    const len = data.length;
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

  // Attempt 3: Downscale / Upscale if image is too large or too small
  const targetSizes = [800, 500, 320];
  for (const targetSize of targetSizes) {
    if (Math.max(width, height) > targetSize * 1.25) {
      try {
        const scale = targetSize / Math.max(width, height);
        const sw = Math.round(width * scale);
        const sh = Math.round(height * scale);
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = sw;
        scaledCanvas.height = sh;
        const sctx = scaledCanvas.getContext('2d');
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
 * Detects the QR matrix bounding box from an image by scanning high-frequency transition density
 */
export function detectQRBoundingBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | null {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const blockSize = Math.max(4, Math.floor(Math.min(width, height) / 60));
  const cols = Math.floor(width / blockSize);
  const rows = Math.floor(height / blockSize);

  const density = Array.from({ length: rows }, () => new Float32Array(cols));
  let maxDensity = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let transitionCount = 0;
      const startX = c * blockSize;
      const startY = r * blockSize;

      for (let y = startY; y < Math.min(height - 1, startY + blockSize); y += 2) {
        for (let x = startX; x < Math.min(width - 1, startX + blockSize); x += 2) {
          const idx1 = (y * width + x) * 4;
          const idxRight = (y * width + (x + 1)) * 4;
          const idxDown = ((y + 1) * width + x) * 4;

          const r1 = data[idx1], g1 = data[idx1 + 1], b1 = data[idx1 + 2];
          const sat1 = Math.max(r1, g1, b1) - Math.min(r1, g1, b1);
          const l1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;

          const lRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
          const lDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];

          // Black/white pattern transitions have low saturation and sharp luminance jumps
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

  // Threshold to isolate the high-density QR module cluster
  const threshold = Math.max(2, maxDensity * 0.2);

  // Find components
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

          // Bridge tolerance across module gaps and center avatar
          const bridge = 3;
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

        if (count >= 6) {
          components.push({ minR, maxR, minC, maxC, count });
        }
      }
    }
  }

  if (components.length === 0) return null;

  // Sort by cluster size
  components.sort((a, b) => b.count - a.count);
  const best = components[0];

  const rawX = best.minC * blockSize;
  const rawY = best.minR * blockSize;
  const rawW = (best.maxC - best.minC + 1) * blockSize;
  const rawH = (best.maxR - best.minR + 1) * blockSize;

  // Add 6% quiet zone margin and force square
  const maxDim = Math.max(rawW, rawH);
  const padding = Math.round(maxDim * 0.06);
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
}

/**
 * Crops and cleans up a QR code from any uploaded image (removes posters, green borders, headers, footers)
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
        const origCanvas = document.createElement('canvas');
        origCanvas.width = img.width;
        origCanvas.height = img.height;
        const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
        if (!origCtx) {
          resolve(dataUrl);
          return;
        }

        origCtx.drawImage(img, 0, 0);

        // 1. Try scanning original full canvas with jsQR
        const fullScanPayload = tryScanCanvas(origCanvas);
        if (fullScanPayload) {
          QRCode.toDataURL(fullScanPayload, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 450,
            color: { dark: '#000000', light: '#ffffff' }
          }).then(resolve).catch(() => resolve(dataUrl));
          return;
        }

        // 2. Detect bounding box of the QR code in the image
        const bbox = detectQRBoundingBox(origCtx, img.width, img.height);
        
        const cropX = bbox ? bbox.x : Math.round((img.width - Math.min(img.width, img.height)) / 2);
        const cropY = bbox ? bbox.y : Math.round((img.height - Math.min(img.width, img.height)) / 2);
        const cropW = bbox ? bbox.width : Math.min(img.width, img.height);
        const cropH = bbox ? bbox.height : Math.min(img.width, img.height);

        // Render cropped canvas
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = 400;
        croppedCanvas.height = 400;
        const croppedCtx = croppedCanvas.getContext('2d', { willReadFrequently: true });
        if (!croppedCtx) {
          resolve(dataUrl);
          return;
        }

        croppedCtx.imageSmoothingEnabled = true;
        croppedCtx.imageSmoothingQuality = 'high';
        croppedCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, 400, 400);

        // 3. Try scanning cropped canvas with jsQR
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

        // 4. Fallback: Clean and binarize the cropped canvas (remove green margins, center avatar, clear noise)
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
            if (x < 24 || x > 376 || y < 24 || y > 376) {
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
        console.error('QR Crop process failed', err);
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
