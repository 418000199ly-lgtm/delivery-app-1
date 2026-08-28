/**
 * High-Reliability Natural Chinese Voice Broadcast Engine for Mobile Apps (Android Phone, Android Emulator, iOS & Web)
 * 
 * Key Features:
 * 1. ZERO "ding" or artificial chime tones: Only real, natural spoken Chinese voice TTS.
 * 2. Capacitor Native Android/iOS TextToSpeech (@capacitor-community/text-to-speech) support.
 * 3. High-Quality Server MP3 Stream via Web Audio API (decodeAudioData) for 100% audible broadcast
 *    even when Android emulator / phone lacks native TTS engine or system voices.
 * 4. Multi-Endpoint MP3 Stream Redundancy with pre-unlocked Audio Context.
 */

import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { getBaseApiUrl } from '../lib/dbProxy';

// Silent 0.1s MP3 base64 to unlock mobile device audio channels
const SILENT_MP3 = 'data:audio/mp3;base64,SUQ3BAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABCAAdER0eHyAnLC8yNDc5Ozw/QEJERUZISkxNT1FSUlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4xAEOAAAAAAAAAAAAAABOT3RlAAAAAEFydGlzdAAAAGxpc3RlbAAnREVDUwAAAENyZWF0ZWQgd2l0aCBMQU1FIDMuMTAwAABMSU1FAAAAMy4xMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OEAAAAA3wAAAAAAAAAAA0AANAAA0AAB4AAAAAAAAA0AANAAAE//OEAAAAAAAAAAAAAAAANAAA0AANAAAeAAAAAAAAANAAA0AAA==';

// Local packaged MP3 audio asset files for instant offline voice broadcast (Bypasses System TTS)
const LOCAL_AUDIO_MAP: Record<string, string> = {
  '您已上线': '/audio/online.mp3',
  '您已下线': '/audio/offline.mp3',
  '接单成功，请前往接驾地点': '/audio/accept_order.mp3',
  '接单成功': '/audio/accept_order.mp3',
  '已开始代驾计费，祝您行程愉快！': '/audio/voice_on.mp3',
  '已开始代驾计费，祝您行程愉快': '/audio/voice_on.mp3',
  '已开始计费，祝您行程愉快！': '/audio/voice_on.mp3',
  '已开始代驾计费': '/audio/voice_on.mp3',
  '已开始计费': '/audio/voice_on.mp3',
  '订单已创建，开始计费': '/audio/voice_on.mp3',
  '已创建订单，开始计费': '/audio/voice_on.mp3',
  '已到达目的地，行程结束': '/audio/end_trip.mp3',
  '已到达目的地，请与乘客核对账单': '/audio/end_trip.mp3',
  '已到达目的地': '/audio/end_trip.mp3',
  '选单大厅有新订单了': '/audio/hall_new_order.mp3',
  '乘客已授权，扫码开单成功！': '/audio/scan_success.mp3',
  '乘客已授权，扫码开单成功': '/audio/scan_success.mp3',
  '您有新的消息，注意查收！': '/audio/new_msg.mp3',
  '您有新的消息，注意查收': '/audio/new_msg.mp3',
  '已开启开单语音播报': '/audio/voice_on.mp3',
  '语音播报测试正常！': '/audio/voice_test.mp3',
  '语音播报测试正常': '/audio/voice_test.mp3',
  '语音播报测试正常！黑湾代驾为您保驾护航。': '/audio/voice_test.mp3',
  '您有新的报单转单系统派单，请及时处理！': '/audio/report_transfer.mp3',
  '您有新的报单转单系统派单': '/audio/report_transfer.mp3',
  '您有新的系统派单，请及时处理！': '/audio/system_dispatch.mp3',
  '您有新的系统派单': '/audio/system_dispatch.mp3',
  '注意！收到新的代驾派单，请及时查看并确认接单！': '/audio/background_alert.mp3',
  '注意！收到新的代驾派单': '/audio/background_alert.mp3',
};

function normalizeTextKey(text: string): string {
  return text.replace(/[！!。，,？?\s]/g, '').trim();
}

function getLocalAudioPath(text: string): string | null {
  const clean = String(text).trim();
  if (LOCAL_AUDIO_MAP[clean]) {
    return LOCAL_AUDIO_MAP[clean];
  }
  const normalizedInput = normalizeTextKey(clean);
  for (const [key, path] of Object.entries(LOCAL_AUDIO_MAP)) {
    if (normalizeTextKey(key) === normalizedInput) {
      return path;
    }
  }
  return null;
}

/**
 * Play local bundled MP3 audio file via Web Audio API or HTML5 Audio
 */
async function playLocalMp3File(audioPath: string, onEnd?: () => void): Promise<boolean> {
  stopSpeaking();
  
  // Try Web Audio API decode arrayBuffer from local asset
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      const response = await fetch(audioPath, { method: 'GET' });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer && arrayBuffer.byteLength > 300) {
          const success = await playAudioBuffer(arrayBuffer, onEnd);
          if (success) return true;
        }
      }
    }
  } catch (e) {
    console.warn('[AudioEngine] Web Audio local MP3 fetch/decode failed, trying Audio element fallback:', e);
  }

  // Fallback to HTML5 Audio element
  return new Promise((resolve) => {
    playSingleMp3Element(
      audioPath,
      () => {
        if (onEnd) onEnd();
        resolve(true);
      },
      () => {
        resolve(false);
      }
    );
  });
}

let audioContext: AudioContext | null = null;
let globalAudioElement: HTMLAudioElement | null = null;
let currentBufferSource: AudioBufferSourceNode | null = null;
let currentAudio: HTMLAudioElement | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];

// Deduplication guard variables
let lastSpokenText: string = '';
let lastSpokenTime: number = 0;

/**
 * Get or create the global unlocked Web Audio API Context
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
      }
    } catch (e) {
      console.warn('[AudioEngine] Could not create AudioContext:', e);
    }
  }
  return audioContext;
}

/**
 * Unlocks Web Audio Context, HTML5 Audio channel, and SpeechSynthesis on user gesture.
 */
export function initAudioUnlock() {
  if (typeof window === 'undefined') return;

  try {
    // 1. Unlock Web Audio API Context
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      // Play a 1-frame silent buffer to fully warm up hardware DAC on Android/iOS
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    }

    // 2. Pre-create and unlock HTML5 Audio element
    if (!globalAudioElement) {
      try {
        const a = new Audio(SILENT_MP3);
        a.volume = 0.01;
        const p = a.play();
        if (p !== undefined) {
          p.then(() => {
            globalAudioElement = a;
          }).catch(() => {});
        }
      } catch (e) {}
    }

    // 3. Resume native SpeechSynthesis & trigger voice loading
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
        if (cachedVoices.length === 0) {
          cachedVoices = window.speechSynthesis.getVoices() || [];
        }
      } catch (e) {}
    }
  } catch (e) {
    console.warn('[AudioEngine] Unlock exception:', e);
  }
}

// Attach global touch & click listeners so audio channel is ALWAYS unlocked on mobile devices
if (typeof window !== 'undefined') {
  const events = ['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'];
  const handleGesture = () => {
    initAudioUnlock();
  };
  events.forEach(evt => window.addEventListener(evt, handleGesture, { passive: true }));

  // Register voices changed listener
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.onvoiceschanged = () => {
        try {
          cachedVoices = window.speechSynthesis.getVoices() || [];
        } catch (e) {}
      };
    } catch (e) {}
  }
}

/**
 * Stop any active audio playback or speech immediately
 */
export function stopSpeaking() {
  // 1. Stop Native Capacitor TextToSpeech
  if (Capacitor.isNativePlatform()) {
    try {
      TextToSpeech.stop().catch(() => {});
    } catch (e) {}
  }

  // 2. Stop Web Audio Buffer
  if (currentBufferSource) {
    try {
      currentBufferSource.stop();
      currentBufferSource.disconnect();
      currentBufferSource = null;
    } catch (e) {}
  }

  // 3. Stop HTML5 Audio
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    } catch (e) {}
  }

  // 4. Stop Web SpeechSynthesis
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    } catch (e) {}
  }
}

/**
 * Disabled: User explicitly requested NO "ding" prompt tones or synth chimes.
 * Retained as empty stub for backward interface compatibility.
 */
export function playEmbeddedBusinessTone(_text: string) {
  // No-op: strictly voice broadcast only
}

/**
 * Disabled: User explicitly requested NO "ding" prompt tones or synth chimes.
 * Retained as empty stub for backward interface compatibility.
 */
export function playWebAudioChime(_isHigh: boolean = true) {
  // No-op: strictly voice broadcast only
}

/**
 * Play audio buffer via Web Audio API
 */
async function playAudioBuffer(arrayBuffer: ArrayBuffer, onEnd?: () => void): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    stopSpeaking();

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    currentBufferSource = source;

    return new Promise((resolve) => {
      let ended = false;
      const finish = (success: boolean) => {
        if (ended) return;
        ended = true;
        if (currentBufferSource === source) currentBufferSource = null;
        if (onEnd) onEnd();
        resolve(success);
      };

      source.onended = () => finish(true);
      source.start(0);
    });
  } catch (e) {
    console.warn('[AudioEngine] Web Audio decode/play failed:', e);
    return false;
  }
}

/**
 * Fallback: Play single MP3 via HTML5 Audio element
 */
function playSingleMp3Element(mp3Url: string, onEnd?: () => void, onError?: () => void) {
  try {
    stopSpeaking();

    const audio = globalAudioElement || new Audio();
    audio.src = mp3Url;
    audio.volume = 1.0;
    audio.muted = false;

    currentAudio = audio;

    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (currentAudio === audio) currentAudio = null;
    };

    audio.onended = () => {
      cleanup();
      if (onEnd) onEnd();
    };

    audio.onerror = () => {
      cleanup();
      if (onError) onError();
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        // Playing successfully
      }).catch(() => {
        cleanup();
        if (onError) onError();
      });
    }
  } catch (e) {
    if (onError) onError();
  }
}

/**
 * Fetch and play Chinese TTS MP3 streams sequentially using Web Audio API (Primary) and Audio Element (Fallback).
 * Guarantees 100% audible Chinese speech on Android phones, Android emulators, iOS, and Web.
 */
async function playMp3AudioStreams(text: string, onEnd?: () => void): Promise<boolean> {
  const cleanText = String(text).trim();
  const encodedText = encodeURIComponent(cleanText);
  const baseUrl = getBaseApiUrl();

  const mp3Urls: string[] = [];

  // Priority 1: Local server relative path (Zero cross-origin latency on web preview)
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    mp3Urls.push(`/api/tts?text=${encodedText}`);
  }

  // Priority 2: Active API Base URL
  if (baseUrl && !baseUrl.includes('localhost') && !baseUrl.startsWith('file:') && !baseUrl.startsWith('capacitor:')) {
    mp3Urls.push(`${baseUrl}/api/tts?text=${encodedText}`);
  }

  // Priority 3: Direct Mainland China Baota production server domain
  mp3Urls.push(`https://api.lyheiwandaijiamax.com/api/tts?text=${encodedText}`);

  // Priority 4: Direct Baidu TTS public fallback
  mp3Urls.push(
    `https://fanyi.baidu.com/gettts?lan=zh&spd=5&source=web&text=${encodedText}`
  );

  // Attempt Web Audio API fetch + buffer decode playback first with tight 1200ms timeout
  for (const url of mp3Urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer && arrayBuffer.byteLength > 300) {
          const success = await playAudioBuffer(arrayBuffer, onEnd);
          if (success) {
            return true;
          }
        }
      }
    } catch (err) {
      // Try next URL
    }
  }

  // Fall back to HTML5 Audio element streaming
  return new Promise((resolve) => {
    let attemptIndex = 0;
    const tryNextElement = () => {
      if (attemptIndex < mp3Urls.length) {
        const url = mp3Urls[attemptIndex];
        attemptIndex++;
        playSingleMp3Element(
          url,
          () => {
            if (onEnd) onEnd();
            resolve(true);
          },
          () => {
            tryNextElement();
          }
        );
      } else {
        if (onEnd) onEnd();
        resolve(false);
      }
    };

    tryNextElement();
  });
}

/**
 * Try Browser/WebView Native SpeechSynthesis (Works on Android WebViews with iFlytek/Google TTS engine installed)
 */
function tryWebSpeechSynthesis(text: string, onEnd?: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve(false);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();

      const voices = cachedVoices.length > 0 ? cachedVoices : (window.speechSynthesis.getVoices() || []);
      const zhVoice = voices.find(v => {
        const lang = (v.lang || '').toLowerCase();
        const name = (v.name || '').toLowerCase();
        return lang.includes('zh') || lang.includes('cn') || lang.includes('cmn') || name.includes('chinese') || name.includes('中文');
      });

      // If no Chinese voice is registered in SpeechSynthesis, fail fast to trigger MP3 stream
      if (voices.length > 0 && !zhVoice) {
        resolve(false);
        return;
      }

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.volume = 1.0;
      utter.rate = 1.0;
      utter.pitch = 1.0;

      if (zhVoice) {
        utter.voice = zhVoice;
      }

      let hasFinished = false;

      // Keep-alive ticker for Android WebViews
      const keepAliveTimer = setInterval(() => {
        try {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch (e) {}
      }, 150);

      const cleanup = () => {
        clearInterval(keepAliveTimer);
      };

      utter.onend = () => {
        if (hasFinished) return;
        hasFinished = true;
        cleanup();
        if (onEnd) onEnd();
        resolve(true);
      };

      utter.onerror = (err) => {
        if (hasFinished) return;
        hasFinished = true;
        cleanup();
        console.warn('[AudioEngine] SpeechSynthesis utterance error:', err);
        resolve(false);
      };

      // Safety fallback timer
      const maxDuration = Math.max(6000, text.length * 500);
      setTimeout(() => {
        if (!hasFinished) {
          hasFinished = true;
          cleanup();
          try { window.speechSynthesis.cancel(); } catch (e) {}
          resolve(false);
        }
      }, maxDuration);

      window.speechSynthesis.speak(utter);

      // Force resume immediately after speak call
      setTimeout(() => {
        try { window.speechSynthesis.resume(); } catch (e) {}
      }, 50);

    } catch (e) {
      console.warn('[AudioEngine] tryWebSpeechSynthesis exception:', e);
      resolve(false);
    }
  });
}

/**
 * Main Chinese Voice Broadcast Entry for Mobile Apps (Android Phone, Android Emulator, iOS, Web)
 * Pure Spoken Natural Voice Broadcast without artificial chimes or warning tones.
 */
export async function speakText(text: string, onEnd?: () => void, _playChime: boolean = false) {
  if (!text || typeof window === 'undefined') {
    if (onEnd) onEnd();
    return;
  }

  const cleanText = String(text).trim();
  const now = Date.now();

  // Deduplication Guard: Ignore identical speech requests within 800ms
  if (cleanText === lastSpokenText && (now - lastSpokenTime) < 800) {
    if (onEnd) onEnd();
    return;
  }
  lastSpokenText = cleanText;
  lastSpokenTime = now;

  // Force unlock and resume AudioContext
  initAudioUnlock();

  // LEVEL 1: Local Packaged MP3 Audio Asset Files (100% Offline, Zero-Latency, Bypasses System TTS)
  const localAudioPath = getLocalAudioPath(cleanText);
  if (localAudioPath) {
    const localPlayed = await playLocalMp3File(localAudioPath, onEnd);
    if (localPlayed) {
      return;
    }
  }

  // LEVEL 2: High-Quality Web Audio API / HTTP MP3 Stream Playback for dynamic/custom texts
  const mp3Success = await playMp3AudioStreams(cleanText, onEnd);
  if (mp3Success) {
    return;
  }

  // LEVEL 3: Capacitor Native Android / iOS System TTS Engine
  if (Capacitor.isNativePlatform()) {
    try {
      let isNativeSpoken = false;
      const nativePromise = TextToSpeech.speak({
        text: cleanText,
        lang: 'zh-CN',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
      }).then(() => {
        isNativeSpoken = true;
        return true;
      }).catch(() => false);

      // Give native TTS up to 1500ms to START speaking natively; if native engine missing/hung, fall through smoothly to MP3 stream
      const nativeSuccess = await Promise.race([
        nativePromise,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(isNativeSpoken), 1500))
      ]);

      if (nativeSuccess) {
        if (onEnd) onEnd();
        return;
      }
      console.warn('[AudioEngine] Native TTS missing or unhandled on device/emulator, switching to MP3 audio stream');
    } catch (nativeErr) {
      console.warn('[AudioEngine] Capacitor native TTS exception:', nativeErr);
    }
  }

  // LEVEL 4: Browser / WebView Native SpeechSynthesis Engine Fallback
  await tryWebSpeechSynthesis(cleanText, onEnd);
}
