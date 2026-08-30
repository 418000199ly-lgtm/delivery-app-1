// Lightweight, 100% offline WAV audio synthesizer for Android APK, iOS & Web
// Dynamically generates clean base64 WAV buffers in memory without massive static JSON files.

interface ToneNote {
  freq: number;
  start: number;
  end: number;
  vol?: number;
}

const AUDIO_CONFIGS: Record<string, ToneNote[]> = {
  'online.mp3': [
    { freq: 523.25, start: 0.0, end: 0.2, vol: 0.7 },
    { freq: 659.25, start: 0.15, end: 0.35, vol: 0.7 },
    { freq: 783.99, start: 0.3, end: 0.6, vol: 0.8 }
  ],
  'offline.mp3': [
    { freq: 783.99, start: 0.0, end: 0.25, vol: 0.7 },
    { freq: 523.25, start: 0.2, end: 0.5, vol: 0.7 }
  ],
  'accept_order.mp3': [
    { freq: 659.25, start: 0.0, end: 0.18, vol: 0.7 },
    { freq: 783.99, start: 0.15, end: 0.33, vol: 0.7 },
    { freq: 1046.50, start: 0.3, end: 0.65, vol: 0.85 }
  ],
  'voice_on.mp3': [
    { freq: 523.25, start: 0.0, end: 0.15, vol: 0.6 },
    { freq: 783.99, start: 0.12, end: 0.27, vol: 0.7 },
    { freq: 1046.50, start: 0.24, end: 0.39, vol: 0.8 },
    { freq: 1318.51, start: 0.36, end: 0.7, vol: 0.85 }
  ],
  'end_trip.mp3': [
    { freq: 1046.50, start: 0.0, end: 0.2, vol: 0.8 },
    { freq: 783.99, start: 0.18, end: 0.38, vol: 0.7 },
    { freq: 523.25, start: 0.35, end: 0.65, vol: 0.7 }
  ],
  'hall_new_order.mp3': [
    { freq: 880.00, start: 0.0, end: 0.15, vol: 0.8 },
    { freq: 1318.51, start: 0.12, end: 0.45, vol: 0.85 }
  ],
  'scan_success.mp3': [
    { freq: 1046.50, start: 0.0, end: 0.15, vol: 0.7 },
    { freq: 1318.51, start: 0.12, end: 0.45, vol: 0.85 }
  ],
  'new_msg.mp3': [
    { freq: 587.33, start: 0.0, end: 0.12, vol: 0.6 },
    { freq: 880.00, start: 0.1, end: 0.35, vol: 0.8 }
  ],
  'voice_test.mp3': [
    { freq: 523.25, start: 0.0, end: 0.15, vol: 0.7 },
    { freq: 659.25, start: 0.13, end: 0.28, vol: 0.7 },
    { freq: 783.99, start: 0.26, end: 0.41, vol: 0.8 },
    { freq: 1046.50, start: 0.39, end: 0.75, vol: 0.85 }
  ],
  'report_transfer.mp3': [
    { freq: 880.00, start: 0.0, end: 0.18, vol: 0.75 },
    { freq: 1046.50, start: 0.15, end: 0.33, vol: 0.8 },
    { freq: 1318.51, start: 0.3, end: 0.65, vol: 0.85 }
  ],
  'system_dispatch.mp3': [
    { freq: 783.99, start: 0.0, end: 0.18, vol: 0.75 },
    { freq: 987.77, start: 0.15, end: 0.33, vol: 0.8 },
    { freq: 1174.66, start: 0.3, end: 0.65, vol: 0.85 }
  ],
  'background_alert.mp3': [
    { freq: 880.00, start: 0.0, end: 0.12, vol: 0.85 },
    { freq: 1174.66, start: 0.1, end: 0.22, vol: 0.85 },
    { freq: 880.00, start: 0.2, end: 0.32, vol: 0.85 },
    { freq: 1174.66, start: 0.3, end: 0.55, vol: 0.9 }
  ]
};

function generateWavBase64(frequencies: ToneNote[], durationSec = 0.8, sampleRate = 22050): string {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = new Uint8Array(44 + dataSize);
  const view = new DataView(buffer.buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      buffer[offset + i] = str.charCodeAt(i);
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sampleVal = 0;
    for (const f of frequencies) {
      if (t >= f.start && t <= f.end) {
        const toneT = t - f.start;
        const toneLen = f.end - f.start;
        let env = 1.0;
        if (toneT < 0.04) env = toneT / 0.04;
        if (toneT > toneLen - 0.06) env = (toneLen - toneT) / 0.06;
        if (env < 0) env = 0;
        const vol = f.vol !== undefined ? f.vol : 0.6;
        sampleVal += Math.sin(2 * Math.PI * f.freq * t) * vol * env;
      }
    }
    sampleVal = Math.max(-1, Math.min(1, sampleVal));
    const intSample = Math.floor(sampleVal * 32767);
    view.setInt16(44 + i * 2, intSample, true);
  }

  let binary = '';
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  const b64 = (typeof window !== 'undefined' && typeof window.btoa === 'function')
    ? window.btoa(binary)
    : (typeof Buffer !== 'undefined' ? Buffer.from(buffer).toString('base64') : '');

  return 'data:audio/wav;base64,' + b64;
}

const audioCache: Record<string, string> = {};

export const BUNDLED_AUDIO_BASE64: Record<string, string> = new Proxy({}, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    const cleanKey = prop.split('/').pop() || prop;
    const mp3Key = cleanKey.replace(/\.wav$/i, '.mp3');
    if (audioCache[cleanKey]) return audioCache[cleanKey];
    if (audioCache[mp3Key]) return audioCache[mp3Key];

    const freqs = AUDIO_CONFIGS[mp3Key] || AUDIO_CONFIGS['online.mp3'];
    const generated = generateWavBase64(freqs);
    audioCache[cleanKey] = generated;
    audioCache[mp3Key] = generated;
    return generated;
  }
});
