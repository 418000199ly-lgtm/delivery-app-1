# Project Guidelines & GitHub Sync Commit Conventions

## GitHub Sync Commit Messages
When the user requests GitHub sync, code push, or asks "What changes did you make?" / "填写What changes did you make?", ALWAYS generate a clear, formatted commit message ready to paste into the AI Studio "What changes did you make?" input box.

### Latest Update Commit Message:
fix(ci): fix GitHub Actions upload-artifact ECONNRESET and Node 24 runner compatibility for Android & iOS builds

## Mobile & Packaging Rules
1. App Icon: `hwdjtb.png` is the standard lossless 1024x1024 full-bleed icon stored locally in `public/hwdjtb.png` and `src/assets/images/hwdjtb.png`.
2. Mobile Assets Script: `python3 scripts/generate_mobile_assets.py` auto-scales icons for Android (`res/mipmap-*`), iOS (`Assets.xcassets`), and PWA (`public/icons/`).
3. GitHub Actions: `.github/workflows/build-mobile.yml` builds Android APK and Web/Baota deployment artifacts automatically on push using `npm ci --legacy-peer-deps`.
