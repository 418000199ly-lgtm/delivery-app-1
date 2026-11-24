# 双版本（渠道分流）说明

2026-11-24 建立。同一套代码、同一个包名 com.heiwan.daijia、同一签名，出两个版本：

| 版本 | 用途 | 构建方式 | CI 产物 |
|---|---|---|---|
| 司机版（driver） | 现有司机在用，自家渠道分发，**功能全开、行为零变化** | 默认构建（不注入 VITE_CHANNEL） | HeiWan-Driver-Android-v2.0-APK / HeiWan-Driver-iOS-v2.0-IPA |
| 商店版（store） | 专供华为应用市场审核上架 | 注入 `VITE_CHANNEL=store` 构建 + CI 内改 AndroidManifest | HeiWan-Store-Android-v2.0-APK（文件名：黑湾代驾MAX-商店版-Android-v2.0.apk） |

## 分流机制

- Web 层：`src/lib/channel.ts` 的 `IS_STORE_BUILD`（构建时由 `VITE_CHANNEL` 注入，未注入=false）。
- 原生层：AndroidManifest 里 meta-data `heiwan_channel`（仓库默认 `driver`）；MainActivity 启动时读取，`store` 时显式关闭 showWhenLocked/turnScreenOn 且不请求解除锁屏。CI 商店版作业在自己检出目录内用 sed 把该值改成 `store`、把 activity 的 showWhenLocked/turnScreenOn 属性改 false（替换失败即构建失败，防混包），不回写仓库。
- 本地出商店版 Web 产物：`npm run build:store`（仅 vite build，不含服务端）。

## 商店版与司机版的全部差异（对应华为 2026-11-24 驳回 8 条）

1. 测试账号登不进 → 服务端固定码改 4 位 `7319`（测试号 15121904440；App 登录页只收 4 位、真实短信码本就是 4 位）。服务端独立部署提交 41fde531（基于 e821f715、仅此一行、不含未部署的城市闸门），部署包 `daijia_deploy_41fde531.zip`。
2. 覆盖锁屏 → 原生门控如上，商店版关掉锁屏覆盖；司机版新单亮屏提醒不变。
3. 功能异常 → 商店版：支付选择层整体不渲染（微信支付死按钮随之消失，钱包充值与会员购买各一处）；新增系统返回键处理（未登录退出 App、已登录最小化）。司机版不注册返回键处理、行为不变。
4. 隐私未明示 → 商店版隐私政策开头加明示句（会收集个人信息；除第六节情形外不与第三方共享、不出售）。privacy.html（AGC 政策链接指向的公开页）已同步同一文案，需重新上传到主域名根目录才对审核员可见。
5. 声明与实际不一致 → 商店版政策第一节第 6 条删去「设备型号、操作系统版本」，只留「应用版本号与登录凭证」；privacy.html 同步。AGC 隐私标签勿勾设备标识类。
6. 权限用途未同步告知 → 商店版首次触发定位/通知权限前先弹用途说明框（`StorePermissionPurpose` + `storePermissionGate.ts`，不自动消失、点「知道了，继续」后才继续初始化），司机版不弹。
7. 付费无客服联系方式 → 商店版会员购买页底部与钱包页改为客服提示块：只留邮箱 418000199@qq.com，不加电话（用户 2026-11-24 拍板）。
8. 个人账号 + 支付交易 → 商店版隐藏全部支付发起入口：会员购买页无支付按钮（套餐与权益仅展示）、钱包页无充值按钮、两个支付选择层均不渲染；服务端支付接口不变（司机版照常使用）。商店版同时关掉 App 内自更新检查（走应用市场更新）。

## 重提华为时的配套动作

1. 部署 `daijia_deploy_41fde531.zip`（固定码 7319 生效），外网验 /api/health 的 version=41fde531、hmac=true。
2. 把更新后的 privacy.html 上传到主域名根目录覆盖旧文件。
3. 推送 main 触发 CI，用 **商店版 APK**（HeiWan-Store-Android-v2.0-APK）上传 AGC，版本号用新构建号。
4. AGC 审核信息里测试账号仍填 15121904440，验证码改填 **7319**，备注写明：验证码为 4 位；可测报单与二维码创单。
5. 上架通过后照旧三件事：恢复测试号入队、删除固定码分支再部署、拿上架截图回支付宝补全提额。

## 本地验证结果（2026-11-24）

- tsc 干净；司机版与商店版 vite build 均成功；产物实查：商店版 bundle 内联 `VITE_CHANNEL:"store"`、司机版无此值（门控确实只在商店版生效）。
- 四路无头冒烟（两版本 × 桌面/真机分支）全过：DOM 174KB/161KB 健康签名、含登录页、无 Uncaught。
- 服务端 41fde531 本地实测：/api/health 返回 version=41fde531、hmac=true；15121904440+7319 登录成功发 token，旧码 731946 被拒。
- CI 商店版 sed 锚点（heiwan_channel 值、showWhenLocked、turnScreenOn）在清单中各出现恰好 1 次，替换可靠。

## 注意

- 司机版与商店版包名、签名相同：同一台手机上互相覆盖安装，不要把商店版发给司机（支付入口没了）。
- 城市闸门（服务端 + App）仍是未部署未推送状态，与本次分流改动同在工作区，推送时一并上 main；服务端部署包仍须单独打、不得把闸门混进 41fde531 那个包。
