package com.heiwan.daijia;

import android.app.Activity;

import com.alipay.sdk.app.PayTask;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Map;

/**
 * 支付宝 App 支付原生插件（HeiwanAlipay）。
 * 职责：拿服务端签好的订单串（orderString）调支付宝 SDK 拉起收银台，
 * 把 SDK 同步返回的 resultStatus / memo / result 原样回给 JS。
 * 注意：同步结果只代表客户端流程结束，是否真正到账以服务端异步通知/查单为准。
 * JS 侧入口：src/lib/alipayPay.ts。SDK：com.alipay.sdk:alipaysdk-android。
 */
@CapacitorPlugin(name = "HeiwanAlipay")
public class HeiwanAlipayPlugin extends Plugin {

    private static String nz(String s) {
        return s != null ? s : "";
    }

    @PluginMethod
    public void pay(PluginCall call) {
        String orderString = call.getString("orderString");
        if (orderString == null || orderString.isEmpty()) {
            call.reject("缺少订单参数 orderString");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前页面不可用，无法拉起支付宝");
            return;
        }
        // PayTask.payV2 是同步阻塞调用（等用户在支付宝里完成支付才返回），
        // 官方要求不能在主线程执行，放到工作线程跑。
        new Thread(() -> {
            try {
                PayTask payTask = new PayTask(activity);
                Map<String, String> result = payTask.payV2(orderString, true);
                JSObject ret = new JSObject();
                ret.put("resultStatus", nz(result != null ? result.get("resultStatus") : null));
                ret.put("memo", nz(result != null ? result.get("memo") : null));
                ret.put("result", nz(result != null ? result.get("result") : null));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("拉起支付宝支付失败：" + e.getMessage());
            }
        }).start();
    }
}
