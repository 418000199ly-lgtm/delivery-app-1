package com.heiwan.daijia;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * 2026-11-01 App 自更新原生插件（HeiwanInstaller）。
 * 职责：App 内下载新版 APK（断点续传+进度事件）→ SHA-256 校验 →
 * 拉起系统安装页。全程只用 Android 标准 API，无第三方依赖。
 * JS 侧入口：src/lib/appUpdate.ts。
 */
@CapacitorPlugin(name = "HeiwanInstaller")
public class HeiwanInstallerPlugin extends Plugin {

    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static String sha256Hex(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        FileInputStream in = new FileInputStream(f);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        in.close();
        byte[] d = md.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("打开系统设置失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName", "update.apk");
        String expectSha = call.getString("sha256", "");
        long expectSize = call.getLong("size", 0L);
        if (url == null || url.isEmpty()) {
            call.reject("缺少下载地址");
            return;
        }
        // 文件名只取 basename，防路径穿越
        fileName = new File(fileName).getName();
        File target = new File(updatesDir(), fileName);
        try {
            boolean alreadyComplete = target.exists() && expectSize > 0 && target.length() == expectSize;
            if (!alreadyComplete) {
                long existing = target.exists() ? target.length() : 0;
                if (expectSize > 0 && existing > expectSize) {
                    // 残留文件比目标还大，必是旧包残片，删掉重下
                    target.delete();
                    existing = 0;
                }
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);
                if (existing > 0) conn.setRequestProperty("Range", "bytes=" + existing + "-");
                int code = conn.getResponseCode();
                boolean append = false;
                long startAt = 0;
                if (code == HttpURLConnection.HTTP_PARTIAL) {
                    append = true;
                    startAt = existing;
                } else if (code == HttpURLConnection.HTTP_OK) {
                    append = false;
                    startAt = 0;
                } else {
                    call.reject("下载失败，服务器返回 " + code);
                    return;
                }
                long contentLen = conn.getContentLengthLong();
                long total = expectSize > 0 ? expectSize : (contentLen > 0 ? startAt + contentLen : -1);
                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(target, append);
                byte[] buf = new byte[65536];
                long loaded = startAt;
                long lastNotify = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    loaded += n;
                    if (loaded - lastNotify >= 262144) {
                        lastNotify = loaded;
                        JSObject ev = new JSObject();
                        ev.put("loaded", loaded);
                        ev.put("total", total);
                        notifyListeners("downloadProgress", ev);
                    }
                }
                out.flush();
                out.close();
                in.close();
                conn.disconnect();
                JSObject ev = new JSObject();
                ev.put("loaded", loaded);
                ev.put("total", total > 0 ? total : loaded);
                notifyListeners("downloadProgress", ev);
            }
            // 完整性校验：指纹不对直接删包拒绝安装，绝不把坏包/错包交给系统安装器
            if (expectSha != null && !expectSha.isEmpty()) {
                String actual = sha256Hex(target);
                if (!actual.equalsIgnoreCase(expectSha)) {
                    target.delete();
                    call.reject("安装包校验失败（指纹不符），已删除，请重试");
                    return;
                }
            }
            // 未授「允许安装未知应用」：先引导去系统设置，JS 侧提示后由用户点继续再调本方法
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                s.setData(Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
                call.reject("NEED_INSTALL_PERMISSION");
                return;
            }
            // 拉起系统安装页
            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", target);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("bytes", target.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("下载/安装失败：" + e.getMessage());
        }
    }
}
