package com.heiwan.daijia;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 2026-11-26 原生听单定位服务（仅安卓）：根治「切后台/锁屏后附近页变灰」。
 *
 * 根因（2026-11-26 生产实证）：此前全部定位上报链都终结在网页层 JS——
 * 自适应上报循环是 JS 定时器、社区后台定位插件的回调也要经桥回到 JS 才
 * fetch 上报。App 一切后台，Capacitor 桥暂停 WebView、国产 ROM 再冻结
 * 进程，JS 整体停摆：R15 锁屏后 34 分钟零上报，服务端看门狗 300 秒无
 * 定位强制下线（kickReason=gps_timeout_300s），附近页随之变灰；通知栏
 * 「听单中」是系统挂着的前台服务通知，不代表 App 还在上报。
 *
 * 本服务把「取定位 + 上报」整条链搬进原生前台服务，与 WebView 完全解耦：
 * - LocationManager 直取 GPS/网络定位（不依赖谷歌服务，国产机可用），
 *   回调在本服务自己的 HandlerThread 上，不经主线程、不经 JS；
 * - 坐标在原生侧做 WGS-84 → GCJ-02 转换（算法与 coordinateTransform.ts
 *   逐常数移植），再用 HttpURLConnection 直发 /api/driver/location，
 *   字段口径与 JS 上报一致（lastUpdatedBy=Native ForegroundService）；
 * - 上报节流与 JS 同口径：位移 ≥10 米或距上次上报 ≥15 秒才发；另有
 *   20 秒一轮的心跳检查：≥45 秒没发过就用最近一次定位补发一笔，保证
 *   与服务端 300 秒看门狗之间留足余量；
 * - 持有 PARTIAL_WAKE_LOCK 保证锁屏 CPU 不睡死定位回调；服务
 *   START_STICKY + 配置落 SharedPreferences，进程被杀重启后凭
 *   listening 标记自恢复（用户手动下线/退出时插件 stop 并清标记）。
 *
 * 配置由 HeiwanLocationPlugin 写入 SharedPreferences（heiwan_loc），
 * 本服务每次上报现读现用，忙闲/今日单数等状态变更无需重启服务。
 */
public class HeiwanLocationService extends Service {

    static final String PREFS = "heiwan_loc";
    static final String KEY_LISTENING = "listening";
    static final String KEY_PHONE = "phone";
    static final String KEY_TOKEN = "token";
    static final String KEY_DRIVER_NAME = "driverName";
    static final String KEY_CITY = "city";
    static final String KEY_IS_BUSY = "isBusy";
    static final String KEY_TODAY_ORDERS = "todayOrders";

    private static final String API_URL = "https://api.lyheiwandaijiamax.com/api/driver/location";
    private static final String CHANNEL_ID = "heiwan_listening";
    private static final int NOTIFICATION_ID = 28352;

    private HandlerThread workerThread;
    private Handler worker;
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private boolean listenersActive = false;

    private volatile long lastUploadAt = 0;
    private volatile double lastUploadedLat = 0;
    private volatile double lastUploadedLng = 0;
    private volatile Location lastFix = null;

    private final LocationListener listener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            if (location == null) return;
            lastFix = location;
            maybeUpload(location, false);
        }

        @Override
        public void onProviderEnabled(String provider) {}

        @Override
        public void onProviderDisabled(String provider) {}

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {}
    };

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            try {
                if (System.currentTimeMillis() - lastUploadAt >= 45000) {
                    Location fix = lastFix;
                    if (fix == null) fix = bestLastKnown();
                    if (fix != null) {
                        lastFix = fix;
                        maybeUpload(fix, true);
                    }
                }
            } catch (Exception ignored) {}
            if (worker != null) worker.postDelayed(this, 20000);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        workerThread = new HandlerThread("heiwan-loc");
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "heiwan:listening");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_LISTENING, false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForegroundWithNotification();
        registerListeners();
        if (worker != null) {
            worker.removeCallbacks(heartbeat);
            worker.postDelayed(heartbeat, 20000);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            if (worker != null) worker.removeCallbacks(heartbeat);
        } catch (Exception ignored) {}
        try {
            if (locationManager != null && listenersActive) {
                locationManager.removeUpdates(listener);
            }
        } catch (Exception ignored) {}
        listenersActive = false;
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
        if (workerThread != null) workerThread.quitSafely();
        super.onDestroy();
    }

    private void startForegroundWithNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "听单定位", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("听单期间后台定位上报");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, openIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT);
        int icon = getApplicationInfo().icon != 0
                ? getApplicationInfo().icon
                : android.R.drawable.ic_menu_mylocation;
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setContentTitle("黑湾代驾MAX 听单中")
                .setContentText("正在听单中：为接收附近派单，后台持续上报你的位置")
                .setSmallIcon(icon)
                .setContentIntent(pending)
                .setOngoing(true);
        Notification notification = builder.build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {}
        }
    }

    private void registerListeners() {
        if (listenersActive) return;
        try {
            locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (locationManager == null || worker == null) return;
            // 回调落在服务自己的工作线程 Looper 上，不经主线程与 WebView
            try {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, 5000, 0, listener, worker.getLooper());
            } catch (Exception ignored) {}
            try {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, 5000, 0, listener, worker.getLooper());
            } catch (Exception ignored) {}
            listenersActive = true;
            Location known = bestLastKnown();
            if (known != null) {
                lastFix = known;
                maybeUpload(known, true);
            }
        } catch (Exception ignored) {}
    }

    private Location bestLastKnown() {
        try {
            if (locationManager == null) {
                locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            }
            if (locationManager == null) return null;
            Location best = null;
            String[] providers = {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER};
            for (String p : providers) {
                try {
                    Location l = locationManager.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (Exception ignored) {}
            }
            return best;
        } catch (Exception ignored) {
            return null;
        }
    }

    /** 与 JS 同口径节流：位移 ≥10 米或距上次上报 ≥15 秒才发；force=true 为心跳补发（绕过节流）。 */
    private void maybeUpload(Location fix, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && lastUploadAt > 0) {
            float dist = 0;
            if (lastUploadedLat != 0 && lastUploadedLng != 0) {
                float[] results = new float[1];
                // 节流距离按原始 WGS-84  fix 计算（10 米阈值下与 GCJ-02 口径等价）
                Location.distanceBetween(lastUploadedLat, lastUploadedLng,
                        fix.getLatitude(), fix.getLongitude(), results);
                dist = results[0];
            } else {
                dist = 999;
            }
            if (dist < 10 && now - lastUploadAt < 15000) return;
        }
        upload(fix);
    }

    private void upload(Location fix) {
        final double rawLat = fix.getLatitude();
        final double rawLng = fix.getLongitude();
        if (rawLat == 0 || rawLng == 0) return;
        if (worker == null) return;
        worker.post(() -> {
            HttpURLConnection conn = null;
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
                if (!prefs.getBoolean(KEY_LISTENING, false)) return;
                String phone = prefs.getString(KEY_PHONE, "");
                String token = prefs.getString(KEY_TOKEN, "");
                if (phone == null || phone.isEmpty() || token == null || token.isEmpty()) return;

                double[] gcj = wgs84ToGcj02(rawLng, rawLat);
                JSONObject body = new JSONObject();
                body.put("phone", phone);
                String name = prefs.getString(KEY_DRIVER_NAME, "");
                if (name != null && !name.isEmpty()) body.put("driverName", name);
                body.put("lat", gcj[1]);
                body.put("lng", gcj[0]);
                body.put("isOnline", true);
                body.put("isBusy", prefs.getBoolean(KEY_IS_BUSY, false));
                body.put("todayOrders", prefs.getInt(KEY_TODAY_ORDERS, 0));
                String city = prefs.getString(KEY_CITY, "");
                body.put("city", city == null || city.isEmpty() ? "银川市" : city);
                body.put("version", "V2.0");
                body.put("appVersion", "V2.0");
                body.put("lastUpdatedBy", "Native ForegroundService");
                body.put("timestamp", System.currentTimeMillis());

                conn = (HttpURLConnection) new URL(API_URL).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("X-Auth-Token", token);
                conn.setRequestProperty("X-App-Version", "V2.0");
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                OutputStream os = conn.getOutputStream();
                os.write(payload);
                os.flush();
                os.close();
                int code = conn.getResponseCode();
                if (code == 200) {
                    lastUploadAt = System.currentTimeMillis();
                    lastUploadedLat = rawLat;
                    lastUploadedLng = rawLng;
                }
            } catch (Exception ignored) {
                // 上报失败不抛：心跳 45 秒后自动补发，链条不断
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    // ===== WGS-84 → GCJ-02（与 src/utils/coordinateTransform.ts 逐常数移植） =====

    private static final double GCJ_PI = 3.1415926535897932384626;
    private static final double GCJ_A = 6378245.0;
    private static final double GCJ_EE = 0.00669342162296594323;

    private static boolean outOfChina(double lng, double lat) {
        if (lng < 72.004 || lng > 137.8347) return true;
        if (lat < 0.8293 || lat > 55.8271) return true;
        return false;
    }

    private static double transformLat(double x, double y) {
        double ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
                + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * GCJ_PI) + 20.0 * Math.sin(2.0 * x * GCJ_PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * GCJ_PI) + 40.0 * Math.sin(y / 3.0 * GCJ_PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * GCJ_PI) + 320 * Math.sin(y * GCJ_PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }

    private static double transformLng(double x, double y) {
        double ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
                + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * GCJ_PI) + 20.0 * Math.sin(2.0 * x * GCJ_PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * GCJ_PI) + 40.0 * Math.sin(x / 3.0 * GCJ_PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * GCJ_PI) + 300.0 * Math.sin(x / 30.0 * GCJ_PI)) * 2.0 / 3.0;
        return ret;
    }

    /** 返回 {lng, lat}（GCJ-02）。 */
    private static double[] wgs84ToGcj02(double lng, double lat) {
        if (outOfChina(lng, lat)) return new double[]{lng, lat};
        double dLat = transformLat(lng - 105.0, lat - 35.0);
        double dLng = transformLng(lng - 105.0, lat - 35.0);
        double radLat = lat / 180.0 * GCJ_PI;
        double magic = Math.sin(radLat);
        magic = 1 - GCJ_EE * magic * magic;
        double sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * GCJ_PI);
        dLng = (dLng * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * GCJ_PI);
        return new double[]{lng + dLng, lat + dLat};
    }
}
