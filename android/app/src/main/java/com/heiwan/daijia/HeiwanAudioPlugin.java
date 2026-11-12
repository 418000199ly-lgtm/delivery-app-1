package com.heiwan.daijia;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 2026-11-12 语音播报音频保障插件（HeiwanAudio，仅安卓）。
 *
 * 背景：App 的中文语音播报（内置录音 MP3、原生 TTS、远程 TTS 流）最终都走
 * 安卓「媒体通道」（STREAM_MUSIC）。铃声静音/震动模式本来不掐媒体通道，
 * 但很多司机把媒体音量关到 0（与铃声音量是两条独立通道，按音量键常调错），
 * 于是 App 里所有播报全部无声，且 App 此前无任何原生层音频保障。
 *
 * ensureAudible() 在每次播报前由 JS 调用：
 * 1) 媒体音量低于最大值的 60% 时抬到 60%（只抬不降），保证播报可闻；
 * 2) 申请短时音频焦点（导航指引用途、M MAY_DUCK），让其他 App 的音乐/视频
 *    在播报期间自动压低而不是盖住播报。
 * 勿扰模式（DND）下系统可能拦截音量调整，原生侧 try/catch 吞掉、不阻断播报。
 * 是否播报仍由 App 内「语音播报状态」设置决定，本插件不绕过该设置。
 */
@CapacitorPlugin(name = "HeiwanAudio")
public class HeiwanAudioPlugin extends Plugin {

    private AudioFocusRequest focusRequest;

    @PluginMethod
    public void ensureAudible(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) {
                ret.put("ok", false);
                ret.put("reason", "no_audio_manager");
                call.resolve(ret);
                return;
            }

            ret.put("ringerMode", am.getRingerMode());

            int stream = AudioManager.STREAM_MUSIC;
            int max = am.getStreamMaxVolume(stream);
            int cur = am.getStreamVolume(stream);
            int floor = Math.max(1, Math.round(max * 0.6f));
            ret.put("volumeBefore", cur);
            ret.put("volumeMax", max);
            if (cur < floor) {
                try {
                    am.setStreamVolume(stream, floor, 0);
                } catch (Exception e) {
                    // 勿扰等系统策略拦截时不抛错，播报继续走原流程
                    ret.put("volumeRaiseBlocked", true);
                }
            }
            ret.put("volumeAfter", am.getStreamVolume(stream));

            // 短时音频焦点：播报期间把其他媒体压低（duck），播完系统自动恢复
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build();
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                            .setAudioAttributes(attrs)
                            .setWillPauseWhenDucked(false)
                            .build();
                    am.requestAudioFocus(focusRequest);
                } else {
                    am.requestAudioFocus(null, stream, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                }
                ret.put("focusRequested", true);
            } catch (Exception e) {
                ret.put("focusRequested", false);
            }

            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("reason", String.valueOf(e.getMessage()));
        }
        call.resolve(ret);
    }
}
