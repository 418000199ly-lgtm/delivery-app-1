package com.heiwan.daijia;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 2026-11-26 原生听单定位插件（HeiwanLocation，仅安卓）。
 *
 * JS 侧在司机上线听单时调 start() 把上报配置（手机号、终身令牌、姓名、
 * 城市、忙闲、今日单数）交给原生层并拉起 HeiwanLocationService 前台
 * 服务；下线/退出时调 stop()。行程忙闲等状态变化调 updateState() 只
 * 更新配置，服务每次上报现读现用、无需重启。
 *
 * 配置落在应用私有 SharedPreferences（heiwan_loc），与 WebView 的
 * localStorage 同等私密等级；令牌为一号一令牌终身制，退出登录时 JS
 * 侧停服务并在下次登录时以新账号配置覆盖。
 */
@CapacitorPlugin(name = "HeiwanLocation")
public class HeiwanLocationPlugin extends Plugin {

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(HeiwanLocationService.PREFS, Context.MODE_PRIVATE);
    }

    private void applyConfig(PluginCall call, SharedPreferences.Editor editor) {
        String phone = call.getString("phone");
        if (phone != null) editor.putString(HeiwanLocationService.KEY_PHONE, phone);
        String token = call.getString("token");
        if (token != null) editor.putString(HeiwanLocationService.KEY_TOKEN, token);
        String driverName = call.getString("driverName");
        if (driverName != null) editor.putString(HeiwanLocationService.KEY_DRIVER_NAME, driverName);
        String city = call.getString("city");
        if (city != null) editor.putString(HeiwanLocationService.KEY_CITY, city);
        Boolean isBusy = call.getBoolean("isBusy");
        if (isBusy != null) editor.putBoolean(HeiwanLocationService.KEY_IS_BUSY, isBusy);
        Integer todayOrders = call.getInt("todayOrders");
        if (todayOrders != null) editor.putInt(HeiwanLocationService.KEY_TODAY_ORDERS, todayOrders);
    }

    private void startService() {
        Intent intent = new Intent(getContext(), HeiwanLocationService.class);
        ContextCompat.startForegroundService(getContext(), intent);
    }

    @PluginMethod
    public void start(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            SharedPreferences.Editor editor = prefs().edit();
            editor.putBoolean(HeiwanLocationService.KEY_LISTENING, true);
            applyConfig(call, editor);
            editor.apply();
            startService();
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("reason", String.valueOf(e));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void updateState(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            SharedPreferences.Editor editor = prefs().edit();
            applyConfig(call, editor);
            editor.apply();
            // 服务若被系统杀掉还没自启，借状态更新顺手拉活（listening 时才拉）
            if (prefs().getBoolean(HeiwanLocationService.KEY_LISTENING, false)) {
                startService();
            }
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("reason", String.valueOf(e));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            prefs().edit()
                    .putBoolean(HeiwanLocationService.KEY_LISTENING, false)
                    .apply();
            Intent intent = new Intent(getContext(), HeiwanLocationService.class);
            getContext().stopService(intent);
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("reason", String.valueOf(e));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ignoring = false;
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                ignoring = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            } else {
                ignoring = true;
            }
        } catch (Exception ignored) {}
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    /** 拉起系统「忽略电池优化」授权页（已豁免则不弹）。司机上线时由 JS 至多请求一次。 */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        JSObject ret = new JSObject();
        boolean requested = false;
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            boolean ignoring = pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            ret.put("ignoring", ignoring);
            if (!ignoring && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    requested = true;
                } catch (Exception e) {
                    Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    requested = true;
                }
            }
        } catch (Exception ignored) {}
        ret.put("requested", requested);
        call.resolve(ret);
    }
}
