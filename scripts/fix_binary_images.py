import os
import subprocess
import glob

def run_cmd(cmd):
    try:
        subprocess.run(cmd, shell=True, check=True)
        return True
    except Exception as e:
        print(f"Error running '{cmd}': {e}")
        return False

print("=== Rebuilding All Binary Image Assets with ImageMagick ===")

# 1. Main Lossless App Icon: public/hwdjtb.png and src/assets/images/hwdjtb.png (1024x1024)
hwdjtb_cmd = """convert -size 1024x1024 xc:"#0f172a" \
  -fill "#0d9488" -draw "circle 512,512 512,120" \
  -fill "#f59e0b" -draw "circle 512,512 512,140" \
  -fill "#0f172a" -draw "circle 512,512 512,180" \
  -fill "#14b8a6" -draw "circle 512,512 512,210" \
  -fill "#ffffff" -pointsize 130 -gravity center -draw "text 0,-30 '黑湾代驾'" \
  -fill "#f59e0b" -pointsize 60 -gravity center -draw "text 0,110 'HEIWAN VALET'" \
  PNG32:public/hwdjtb.png"""

run_cmd(hwdjtb_cmd)
run_cmd("cp public/hwdjtb.png src/assets/images/hwdjtb.png")
run_cmd("cp public/hwdjtb.png public/icon.png")
run_cmd("cp public/hwdjtb.png src/assets/images/logo.png")
run_cmd("cp public/hwdjtb.png resources/icon.png")

# 2. Beian Icon (beian.png & beiantubiao.png - 20x20 shield/emblem)
beian_cmd = """convert -size 20x20 xc:transparent \
  -fill "#1d4ed8" -draw "polygon 10,1 19,5 16,16 10,19 4,16 1,5" \
  -fill "#f59e0b" -draw "circle 10,10 10,6" \
  PNG32:public/beian.png"""
run_cmd(beian_cmd)
run_cmd("cp public/beian.png public/beiantubiao.png")

# 3. Favicon (64x64 ico)
run_cmd("convert public/hwdjtb.png -resize 64x64 public/favicon.ico")
run_cmd("convert public/hwdjtb.png -resize 180x180 PNG32:public/apple-touch-icon.png")

# 4. Welcome Background (welcome_bg.jpg & variants - 1080x1920)
bg_cmd = """convert -size 1080x1920 gradient:"#0f172a"-"#1e293b" \
  -fill "#0d9488" -draw "circle 540,400 540,100" \
  -fill "#ffffff" -pointsize 70 -gravity center -draw "text 0,-200 '黑湾代驾 · 极速派单'" \
  -quality 95 public/welcome_bg.jpg"""
run_cmd(bg_cmd)
run_cmd("cp public/welcome_bg.jpg src/assets/images/welcome_bg.jpg")

for f in glob.glob("src/assets/images/welcome_bg*.jpg"):
    run_cmd(f"cp public/welcome_bg.jpg {f}")

# 5. VIP Banner (vip_banner.jpg & variants - 1200x400)
vip_cmd = """convert -size 1200x400 gradient:"#1e1b4b"-"#311b92" \
  -fill "#f59e0b" -draw "roundrectangle 40,40 1160,360 20,20" \
  -fill "#0f172a" -draw "roundrectangle 44,44 1156,356 18,18" \
  -fill "#fbbf24" -pointsize 60 -gravity center -draw "text 0,-30 '黑湾代驾 VIP 尊享会员卡'" \
  -fill "#fef08a" -pointsize 32 -gravity center -draw "text 0,50 '无限次优先派单 · 专属客户经理 · 满额立减'" \
  -quality 95 public/vip_banner.jpg"""
run_cmd(vip_cmd)
run_cmd("cp public/vip_banner.jpg src/assets/images/vip_banner.jpg")

for f in glob.glob("src/assets/images/vip_banner*.jpg"):
    run_cmd(f"cp public/vip_banner.jpg {f}")

# 6. Other JPG Mockups in src/assets/images
qr_cmd = """convert -size 600x600 xc:"#07c160" \
  -fill "#ffffff" -draw "roundrectangle 40,40 560,560 20,20" \
  -fill "#07c160" -pointsize 40 -gravity center -draw "text 0,-150 '微信扫码支付'" \
  -fill "#111827" -draw "rectangle 150,180 450,480" \
  -fill "#ffffff" -draw "rectangle 180,210 420,450" \
  -fill "#07c160" -draw "rectangle 220,250 380,410" \
  -quality 95 src/assets/images/wechat_pay_qr_1782906451645.jpg"""
run_cmd(qr_cmd)
run_cmd("cp src/assets/images/wechat_pay_qr_1782906451645.jpg src/assets/images/vip_payment_mockup_1782906470780.jpg")

seal_cmd = """convert -size 400x400 xc:transparent \
  -stroke "#dc2626" -strokewidth 12 -fill none -draw "circle 200,200 200,20" \
  -stroke none -fill "#dc2626" -pointsize 36 -gravity center -draw "text 0,-40 '黑湾代驾专用章'" \
  -fill "#dc2626" -pointsize 50 -gravity center -draw "text 0,30 '★'" \
  -quality 95 src/assets/images/official_seal_1783720592321.jpg"""
run_cmd(seal_cmd)

avatar_cmd = """convert -size 400x400 xc:"#0d9488" \
  -fill "#ffffff" -draw "circle 200,160 200,80" \
  -fill "#ffffff" -draw "ellipse 200,340 140,100 0 360" \
  -quality 95 src/assets/images/driver_avatar_1784017528877.jpg"""
run_cmd(avatar_cmd)

for f in glob.glob("src/assets/images/driver_*.jpg"):
    if f != "src/assets/images/driver_avatar_1784017528877.jpg":
        run_cmd(f"cp src/assets/images/driver_avatar_1784017528877.jpg {f}")

for f in glob.glob("src/assets/images/hwdj*.jpg") + glob.glob("src/assets/images/app_icon*.jpg"):
    run_cmd(f"cp public/hwdjtb.png {f}")

# Splash screen images for Android & iOS
for root, dirs, files in os.walk('.'):
    if 'node_modules' in root or '.git' in root or 'dist' in root:
        continue
    for file in files:
        if file.startswith('splash') and file.endswith('.png'):
            full_path = os.path.join(root, file)
            run_cmd(f"convert -size 1080x1920 gradient:'#0f172a'-'#1e293b' -fill '#0d9488' -draw 'circle 540,960 540,660' -fill '#ffffff' -pointsize 80 -gravity center -draw 'text 0,200 \"黑湾代驾\"' PNG32:{full_path}")

print("=== Running Mobile Assets Generator (generate_mobile_assets.py) ===")
run_cmd("python3 scripts/generate_mobile_assets.py")

print("=== Binary Image Fix Complete ===")
