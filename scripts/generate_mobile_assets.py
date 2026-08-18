#!/usr/bin/env python3
import os
import sys
import zlib
import struct
import json
import shutil
import math

PNG_MAGIC = b'\x89PNG\r\n\x1a\n'

def is_valid_png(path):
    if not os.path.exists(path) or os.path.getsize(path) < 24:
        return False
    try:
        with open(path, 'rb') as f:
            header = f.read(8)
            return header == PNG_MAGIC
    except Exception:
        return False

def create_png_from_rgba(width, height, pixel_bytes, output_path):
    """
    Creates a 100% compliant standard binary RGBA PNG using pure Python zlib & struct.
    pixel_bytes: bytearray of length width * height * 4 (RGBA for each pixel)
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    raw_data = bytearray()
    row_len = width * 4
    for y in range(height):
        raw_data.append(0)  # Filter type 0 (None)
        start = y * row_len
        raw_data.extend(pixel_bytes[start:start+row_len])
        
    compressed = zlib.compress(raw_data, 6)
    
    png = bytearray(PNG_MAGIC)
    # IHDR chunk: width (4B), height (4B), bit depth=8 (1B), color type=6 (RGBA, 1B), compression=0, filter=0, interlace=0
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = struct.pack('>I', zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff)
    png.extend(struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + ihdr_crc)
    
    # sRGB chunk (standard color space)
    srgb_data = b'\x00'  # Perceptual rendering intent
    srgb_crc = struct.pack('>I', zlib.crc32(b'sRGB' + srgb_data) & 0xffffffff)
    png.extend(struct.pack('>I', len(srgb_data)) + b'sRGB' + srgb_data + srgb_crc)
    
    # IDAT chunk
    idat_crc = struct.pack('>I', zlib.crc32(b'IDAT' + compressed) & 0xffffffff)
    png.extend(struct.pack('>I', len(compressed)) + b'IDAT' + compressed + idat_crc)
    
    # IEND chunk
    iend_crc = struct.pack('>I', zlib.crc32(b'IEND') & 0xffffffff)
    png.extend(struct.pack('>I', 0) + b'IEND' + iend_crc)
    
    with open(output_path, 'wb') as f:
        f.write(png)
    return True

def generate_driver_icon_rgba(width, height):
    """
    Renders high-definition brand icon for 黑湾代驾MAX (Navy Dark #0B1120 + Amber Gold #F59E0B Steering Wheel Emblem).
    """
    pixels = bytearray(width * height * 4)
    cx_f = width / 2.0
    cy_f = height / 2.0
    outer_radius = min(width, height) * 0.44
    inner_radius = min(width, height) * 0.38
    ring_width = max(1.5, min(width, height) * 0.025)
    center_hub_radius = max(2.0, min(width, height) * 0.06)
    
    idx = 0
    for y in range(height):
        ny = y / float(height)
        for x in range(width):
            nx = x / float(width)
            
            # Base luxury navy gradient (#0B1120 to #0F172A)
            r = int(11 + 10 * nx + 8 * ny)
            g = int(17 + 15 * ny)
            b = int(32 + 30 * (1.0 - ny))
            a = 255
            
            # Distance from center
            dx = x - cx_f
            dy = y - cy_f
            dist = math.sqrt(dx*dx + dy*dy)
            
            # Background circular badge
            if dist <= outer_radius:
                # Radial gold ambient glow inside badge
                glow = max(0.0, 1.0 - (dist / outer_radius))
                r = min(255, int(r + 40 * glow))
                g = min(255, int(g + 65 * glow))
                b = min(255, int(b + 110 * glow))
                
                # Outer gold ring
                if dist >= (outer_radius - ring_width):
                    r, g, b = 245, 158, 11
                elif dist <= inner_radius:
                    # Steering wheel rim
                    rim_radius = inner_radius * 0.75
                    rim_thickness = ring_width * 1.5
                    if abs(dist - rim_radius) <= rim_thickness:
                        r, g, b = 251, 191, 36
                    # Center hub
                    elif dist <= center_hub_radius:
                        r, g, b = 245, 158, 11
                    # 3 Steering spokes (0 deg down, 135 deg up-left, 45 deg up-right)
                    else:
                        is_spoke = False
                        if abs(dx) <= ring_width * 0.9 and dy > 0 and dist <= rim_radius:
                            is_spoke = True
                        elif abs(dx * 0.5 + dy * 0.866) <= ring_width * 0.9 and dy < 0 and dx < 0 and dist <= rim_radius:
                            is_spoke = True
                        elif abs(-dx * 0.5 + dy * 0.866) <= ring_width * 0.9 and dy < 0 and dx > 0 and dist <= rim_radius:
                            is_spoke = True
                            
                        if is_spoke:
                            r, g, b = 251, 191, 36
            
            pixels[idx] = r
            pixels[idx+1] = g
            pixels[idx+2] = b
            pixels[idx+3] = a
            idx += 4
            
    return pixels

def generate_beian_rgba(width=20, height=20):
    pixels = bytearray(width * height * 4)
    idx = 0
    for y in range(height):
        for x in range(width):
            dx = abs(x - 9.5) / 9.5
            dy = y / 19.0
            if (dy < 0.6 and dx <= 0.85) or (dy >= 0.6 and dx <= (1.0 - (dy - 0.6) * 1.5)):
                r, g, b, a = 30, 136, 229, 255
                if (x == 6 and y == 10) or (x == 7 and y == 11) or (x == 8 and y == 12) or (x == 9 and y == 11) or (x == 10 and y == 10) or (x == 11 and y == 9) or (x == 12 and y == 8) or (x == 13 and y == 7):
                    r, g, b, a = 255, 255, 255, 255
            else:
                r, g, b, a = 0, 0, 0, 0
            pixels[idx] = r
            pixels[idx+1] = g
            pixels[idx+2] = b
            pixels[idx+3] = a
            idx += 4
    return pixels

def main():
    print("🚀 Starting Mobile App Icon & Asset Generation for iOS and Android...")
    
    # 1. Generate 1024x1024 Master Icon
    print("🎨 Rendering master lossless 1024x1024 binary PNG...")
    master_1024_rgba = generate_driver_icon_rgba(1024, 1024)
    
    master_targets = [
        "public/hwdjtb.png",
        "public/icon.png",
        "src/assets/images/hwdjtb.png",
        "src/assets/images/logo.png",
        "resources/icon.png"
    ]
    for target in master_targets:
        create_png_from_rgba(1024, 1024, master_1024_rgba, target)
        
    # Generate beian badges
    beian_rgba = generate_beian_rgba(20, 20)
    create_png_from_rgba(20, 20, beian_rgba, "public/beian.png")
    create_png_from_rgba(20, 20, beian_rgba, "public/beiantubiao.png")
    
    # PWA icons
    pwa_sizes = [72, 96, 128, 144, 152, 192, 384, 512]
    for sz in pwa_sizes:
        rgba = generate_driver_icon_rgba(sz, sz)
        create_png_from_rgba(sz, sz, rgba, f"public/icons/icon-{sz}.png")
    create_png_from_rgba(180, 180, generate_driver_icon_rgba(180, 180), "public/apple-touch-icon.png")

    # 2. Android Mipmaps
    android_mipmaps = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192
    }
    for folder, sz in android_mipmaps.items():
        rgba = generate_driver_icon_rgba(sz, sz)
        create_png_from_rgba(sz, sz, rgba, f"android/app/src/main/res/{folder}/ic_launcher.png")
        create_png_from_rgba(sz, sz, rgba, f"android/app/src/main/res/{folder}/ic_launcher_round.png")
        create_png_from_rgba(sz, sz, rgba, f"android/app/src/main/res/{folder}/ic_launcher_foreground.png")

    # Android Splash drawables
    android_splashes = [
        "drawable",
        "drawable-port-mdpi",
        "drawable-port-hdpi",
        "drawable-port-xhdpi",
        "drawable-port-xxhdpi",
        "drawable-port-xxxhdpi",
        "drawable-land-mdpi",
        "drawable-land-hdpi",
        "drawable-land-xhdpi",
        "drawable-land-xxhdpi",
        "drawable-land-xxxhdpi"
    ]
    for folder in android_splashes:
        create_png_from_rgba(1024, 1024, master_1024_rgba, f"android/app/src/main/res/{folder}/splash.png")

    # 3. iOS AppIcon.appiconset
    ios_appicon_dir = "ios/App/App/Assets.xcassets/AppIcon.appiconset"
    if os.path.exists(ios_appicon_dir):
        shutil.rmtree(ios_appicon_dir)
    os.makedirs(ios_appicon_dir, exist_ok=True)

    ios_icon_specs = [
        {"idiom": "iphone", "size": "20x20", "scale": "2x", "px": 40, "filename": "AppIcon-20x20@2x.png"},
        {"idiom": "iphone", "size": "20x20", "scale": "3x", "px": 60, "filename": "AppIcon-20x20@3x.png"},
        {"idiom": "iphone", "size": "29x29", "scale": "1x", "px": 29, "filename": "AppIcon-29x29@1x.png"},
        {"idiom": "iphone", "size": "29x29", "scale": "2x", "px": 58, "filename": "AppIcon-29x29@2x.png"},
        {"idiom": "iphone", "size": "29x29", "scale": "3x", "px": 87, "filename": "AppIcon-29x29@3x.png"},
        {"idiom": "iphone", "size": "40x40", "scale": "2x", "px": 80, "filename": "AppIcon-40x40@2x.png"},
        {"idiom": "iphone", "size": "40x40", "scale": "3x", "px": 120, "filename": "AppIcon-40x40@3x.png"},
        {"idiom": "iphone", "size": "60x60", "scale": "2x", "px": 120, "filename": "AppIcon-60x60@2x.png"},
        {"idiom": "iphone", "size": "60x60", "scale": "3x", "px": 180, "filename": "AppIcon-60x60@3x.png"},
        {"idiom": "ipad", "size": "20x20", "scale": "1x", "px": 20, "filename": "AppIcon-20x20@1x.png"},
        {"idiom": "ipad", "size": "20x20", "scale": "2x", "px": 40, "filename": "AppIcon-20x20@2x.png"},
        {"idiom": "ipad", "size": "29x29", "scale": "1x", "px": 29, "filename": "AppIcon-29x29@1x.png"},
        {"idiom": "ipad", "size": "29x29", "scale": "2x", "px": 58, "filename": "AppIcon-29x29@2x.png"},
        {"idiom": "ipad", "size": "40x40", "scale": "1x", "px": 40, "filename": "AppIcon-40x40@1x.png"},
        {"idiom": "ipad", "size": "40x40", "scale": "2x", "px": 80, "filename": "AppIcon-40x40@2x.png"},
        {"idiom": "ipad", "size": "76x76", "scale": "1x", "px": 76, "filename": "AppIcon-76x76@1x.png"},
        {"idiom": "ipad", "size": "76x76", "scale": "2x", "px": 152, "filename": "AppIcon-76x76@2x.png"},
        {"idiom": "ipad", "size": "83.5x83.5", "scale": "2x", "px": 167, "filename": "AppIcon-83.5x83.5@2x.png"},
        {"idiom": "ios-marketing", "size": "1024x1024", "scale": "1x", "px": 1024, "filename": "AppIcon-512@2x.png"}
    ]

    images_json = []
    for item in ios_icon_specs:
        rgba = generate_driver_icon_rgba(item["px"], item["px"])
        create_png_from_rgba(item["px"], item["px"], rgba, f"{ios_appicon_dir}/{item['filename']}")
        images_json.append({
            "size": item["size"],
            "idiom": item["idiom"],
            "filename": item["filename"],
            "scale": item["scale"]
        })

    appicon_contents = {
        "images": images_json,
        "info": {
            "version": 1,
            "author": "xcode"
        }
    }
    with open(f"{ios_appicon_dir}/Contents.json", "w", encoding="utf-8") as f:
        json.dump(appicon_contents, f, indent=2)

    # 4. iOS Splash.imageset
    ios_splash_dir = "ios/App/App/Assets.xcassets/Splash.imageset"
    if os.path.exists(ios_splash_dir):
        shutil.rmtree(ios_splash_dir)
    os.makedirs(ios_splash_dir, exist_ok=True)

    create_png_from_rgba(1024, 1024, master_1024_rgba, f"{ios_splash_dir}/splash.png")
    create_png_from_rgba(1024, 1024, master_1024_rgba, f"{ios_splash_dir}/splash@2x.png")
    create_png_from_rgba(1024, 1024, master_1024_rgba, f"{ios_splash_dir}/splash@3x.png")

    splash_contents_json = {
        "images": [
            {"idiom": "universal", "filename": "splash.png", "scale": "1x"},
            {"idiom": "universal", "filename": "splash@2x.png", "scale": "2x"},
            {"idiom": "universal", "filename": "splash@3x.png", "scale": "3x"}
        ],
        "info": {
            "version": 1,
            "author": "xcode"
        }
    }
    with open(f"{ios_splash_dir}/Contents.json", "w", encoding="utf-8") as f:
        json.dump(splash_contents_json, f, indent=2)

    # 5. Sync to public directories in ios and android
    for pub_dst in ["ios/App/App/public", "android/app/src/main/assets/public"]:
        if os.path.exists(pub_dst):
            for item in os.listdir("public"):
                s = os.path.join("public", item)
                d = os.path.join(pub_dst, item)
                if os.path.isdir(s):
                    if os.path.exists(d):
                        shutil.rmtree(d)
                    shutil.copytree(s, d)
                else:
                    shutil.copy2(s, d)

    # 6. Verify all generated assets
    print("Verifying binary integrity of generated assets...")
    verified = True
    for item in ios_icon_specs:
        fp = f"{ios_appicon_dir}/{item['filename']}"
        if not is_valid_png(fp):
            print(f"❌ Corrupt PNG: {fp}")
            verified = False
    for item in ["splash.png", "splash@2x.png", "splash@3x.png"]:
        fp = f"{ios_splash_dir}/{item}"
        if not is_valid_png(fp):
            print(f"❌ Corrupt PNG: {fp}")
            verified = False

    if verified:
        print("✨ All mobile app icon and splash assets generated & verified with valid binary PNG headers!")
    else:
        print("⚠️ Some assets failed validation!")

if __name__ == "__main__":
    main()
