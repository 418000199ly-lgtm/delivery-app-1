# 黑湾代驾MAX 司机移动端 (Android APK & iOS IPA)

本项目支持通过 GitHub Actions 自动编译出 Android 司机端安装包（APK）和 iOS 司机端安装包（IPA）。

## 📱 自动打包与获取方式

1. 提交代码至 GitHub 仓库的主分支 (`main` 或 `master`)。
2. GitHub Actions 将自动触发打包工作流：`.github/workflows/build-mobile.yml`。
3. 构建完成后，在 GitHub 仓库的 **Actions** -> **Artifacts (构建产物)** 页面即可一键下载：
   - 🤖 `hwdj-driver-android-release-apk` (Android 安装包)
   - 🍏 `hwdj-driver-ios-release-ipa` (iOS 安装包)
