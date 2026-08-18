package com.heiwan.daijia;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.view.WindowManager;
import android.app.KeyguardManager;
import android.os.Build;
import androidx.appcompat.app.AppCompatDelegate;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);

        // Ensure system navigation bar and status bar do not obscure web content on Android
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                getWindow().setDecorFitsSystemWindows(true);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                getWindow().setNavigationBarColor(android.graphics.Color.parseColor("#ffffff"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        // Turn on screen and show over lock screen / other apps when new orders arrive
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
                KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                if (km != null) {
                    km.requestDismissKeyguard(this, null);
                }
            } else {
                getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                );
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        try {
            if (this.getBridge() != null) {
                WebView webView = this.getBridge().getWebView();
                if (webView != null) {
                    WebSettings settings = webView.getSettings();
                    settings.setMediaPlaybackRequiresUserGesture(false);
                    settings.setDomStorageEnabled(true);
                    settings.setJavaScriptEnabled(true);
                    settings.setAllowFileAccess(true);
                    settings.setAllowContentAccess(true);
                    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
