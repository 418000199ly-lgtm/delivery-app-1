#!/usr/bin/env python3
import os
import glob
import subprocess

def optimize_images():
    print("🧹 Optimizing all images across project to ensure lightweight GitHub sync...")

    # 1. Optimize splash images
    splashes = {
        'android/app/src/main/res/drawable/splash.png': (1080, 1920),
        'android/app/src/main/res/drawable-port-mdpi/splash.png': (320, 480),
        'android/app/src/main/res/drawable-port-hdpi/splash.png': (480, 800),
        'android/app/src/main/res/drawable-port-xhdpi/splash.png': (720, 1280),
        'android/app/src/main/res/drawable-port-xxhdpi/splash.png': (960, 1600),
        'android/app/src/main/res/drawable-port-xxxhdpi/splash.png': (1080, 1920),
        'android/app/src/main/res/drawable-land-mdpi/splash.png': (480, 320),
        'android/app/src/main/res/drawable-land-hdpi/splash.png': (800, 480),
        'android/app/src/main/res/drawable-land-xhdpi/splash.png': (1280, 720),
        'android/app/src/main/res/drawable-land-xxhdpi/splash.png': (1600, 960),
        'android/app/src/main/res/drawable-land-xxxhdpi/splash.png': (1920, 1080),
        'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png': (1080, 1920),
        'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png': (1080, 1920),
        'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png': (1080, 1920),
    }

    welcome_src = 'src/assets/images/welcome_bg_1785252479225.jpg'
    if not os.path.exists(welcome_src):
        welcome_src = 'public/welcome_bg.jpg'

    for path, (w, h) in splashes.items():
        if os.path.exists(os.path.dirname(path)):
            cmd = f"convert {welcome_src} -strip -resize {w}x{h}! PNG8:{path}"
            subprocess.run(cmd, shell=True, check=False)

    # 2. Optimize PNG icons & AppIcons
    png_icons = [
        'public/hwdjtb.png',
        'public/icon.png',
        'public/apple-touch-icon.png',
        'src/assets/images/hwdjtb.png',
        'resources/icon.png',
        'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
        'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    ]

    for icon in png_icons:
        if os.path.exists(icon):
            cmd = f"convert {icon} -strip PNG8:{icon}"
            subprocess.run(cmd, shell=True, check=False)

    # 3. Compress all JPEGs in src/assets/images and public
    for jpg in glob.glob('src/assets/images/*.jpg') + glob.glob('public/*.jpg'):
        if os.path.isfile(jpg):
            cmd = f"convert {jpg} -strip -quality 82 {jpg}"
            subprocess.run(cmd, shell=True, check=False)

    print("✅ All project image assets successfully compressed and optimized!")

if __name__ == '__main__':
    optimize_images()
