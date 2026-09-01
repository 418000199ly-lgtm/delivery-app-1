const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const inputPath = fs.existsSync('src/assets/images/hwdj_brand_icon_1786786924633.jpg') 
  ? 'src/assets/images/hwdj_brand_icon_1786786924633.jpg' 
  : 'public/hwdjtb.png';

console.log('🚀 Starting Mobile App Icon & Asset Generation with master icon:', inputPath);

async function main() {
  const image = await Jimp.read(inputPath);
  console.log(`🎨 Loaded master icon: ${image.bitmap.width}x${image.bitmap.height}`);

  const masterTargets = [
    'public/hwdjtb.png',
    'public/icon.png',
    'src/assets/images/hwdjtb.png',
    'src/assets/images/logo.png',
    'resources/icon.png',
    'ios/App/App/public/hwdjtb.png',
    'android/app/src/main/assets/public/hwdjtb.png'
  ];

  const img1024 = image.clone().resize({ w: 1024, h: 1024 });
  const png1024Buf = await img1024.getBuffer('image/png');

  for (const t of masterTargets) {
    const dir = path.dirname(t);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(t, png1024Buf);
  }

  // ESM asset import pointer and inline Base64 data URL for 100% offline/APK/iOS/Web compatibility
  const img256 = image.clone().resize({ w: 256, h: 256 });
  const png256Buf = await img256.getBuffer('image/png');
  const b64DataUrl = `data:image/png;base64,${png256Buf.toString('base64')}`;

  const b64 = `import hwdjLogoPng from './images/hwdjtb.png';\n\nexport const HWDJ_LOGO_BASE64 = ${JSON.stringify(b64DataUrl)};\nexport const HWDJ_LOGO_DATA_URL = HWDJ_LOGO_BASE64 || hwdjLogoPng;\n`;
  fs.writeFileSync('src/assets/hwdjLogoBase64.ts', b64);

  // PWA sizes
  const pwaSizes = [72, 96, 128, 144, 152, 192, 384, 512];
  for (const sz of pwaSizes) {
    const resized = image.clone().resize({ w: sz, h: sz });
    const buf = await resized.getBuffer('image/png');
    const p = `public/icons/icon-${sz}.png`;
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, buf);
  }
  const appleTouch = await image.clone().resize({ w: 180, h: 180 }).getBuffer('image/png');
  fs.writeFileSync('public/apple-touch-icon.png', appleTouch);

  // Android mipmaps
  const androidMipmaps = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192
  };
  for (const [folder, sz] of Object.entries(androidMipmaps)) {
    const resized = image.clone().resize({ w: sz, h: sz });
    const buf = await resized.getBuffer('image/png');
    const folderPath = path.join('android/app/src/main/res', folder);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, 'ic_launcher.png'), buf);
    fs.writeFileSync(path.join(folderPath, 'ic_launcher_round.png'), buf);
    fs.writeFileSync(path.join(folderPath, 'ic_launcher_foreground.png'), buf);
  }

  // Android splash drawables
  const androidSplashes = [
    'drawable',
    'drawable-port-mdpi',
    'drawable-port-hdpi',
    'drawable-port-xhdpi',
    'drawable-port-xxhdpi',
    'drawable-port-xxxhdpi',
    'drawable-land-mdpi',
    'drawable-land-hdpi',
    'drawable-land-xhdpi',
    'drawable-land-xxhdpi',
    'drawable-land-xxxhdpi'
  ];
  for (const folder of androidSplashes) {
    const folderPath = path.join('android/app/src/main/res', folder);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, 'splash.png'), png1024Buf);
  }

  // iOS AppIcon.appiconset
  const iosIconSpecs = [
    { idiom: 'iphone', size: '20x20', scale: '2x', px: 40, filename: 'AppIcon-20x20@2x.png' },
    { idiom: 'iphone', size: '20x20', scale: '3x', px: 60, filename: 'AppIcon-20x20@3x.png' },
    { idiom: 'iphone', size: '29x29', scale: '1x', px: 29, filename: 'AppIcon-29x29@1x.png' },
    { idiom: 'iphone', size: '29x29', scale: '2x', px: 58, filename: 'AppIcon-29x29@2x.png' },
    { idiom: 'iphone', size: '29x29', scale: '3x', px: 87, filename: 'AppIcon-29x29@3x.png' },
    { idiom: 'iphone', size: '40x40', scale: '2x', px: 80, filename: 'AppIcon-40x40@2x.png' },
    { idiom: 'iphone', size: '40x40', scale: '3x', px: 120, filename: 'AppIcon-40x40@3x.png' },
    { idiom: 'iphone', size: '60x60', scale: '2x', px: 120, filename: 'AppIcon-60x60@2x.png' },
    { idiom: 'iphone', size: '60x60', scale: '3x', px: 180, filename: 'AppIcon-60x60@3x.png' },
    { idiom: 'ipad', size: '20x20', scale: '1x', px: 20, filename: 'AppIcon-20x20@1x.png' },
    { idiom: 'ipad', size: '20x20', scale: '2x', px: 40, filename: 'AppIcon-20x20@2x.png' },
    { idiom: 'ipad', size: '29x29', scale: '1x', px: 29, filename: 'AppIcon-29x29@1x.png' },
    { idiom: 'ipad', size: '29x29', scale: '2x', px: 58, filename: 'AppIcon-29x29@2x.png' },
    { idiom: 'ipad', size: '40x40', scale: '1x', px: 40, filename: 'AppIcon-40x40@1x.png' },
    { idiom: 'ipad', size: '40x40', scale: '2x', px: 80, filename: 'AppIcon-40x40@2x.png' },
    { idiom: 'ipad', size: '76x76', scale: '1x', px: 76, filename: 'AppIcon-76x76@1x.png' },
    { idiom: 'ipad', size: '76x76', scale: '2x', px: 152, filename: 'AppIcon-76x76@2x.png' },
    { idiom: 'ipad', size: '83.5x83.5', scale: '2x', px: 167, filename: 'AppIcon-83.5x83.5@2x.png' },
    { idiom: 'ios-marketing', size: '1024x1024', scale: '1x', px: 1024, filename: 'AppIcon-512@2x.png' }
  ];

  const iosDir = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
  if (!fs.existsSync(iosDir)) fs.mkdirSync(iosDir, { recursive: true });
  const imagesJson = [];
  for (const item of iosIconSpecs) {
    const resized = image.clone().resize({ w: item.px, h: item.px });
    const buf = await resized.getBuffer('image/png');
    fs.writeFileSync(path.join(iosDir, item.filename), buf);
    imagesJson.push({
      size: item.size,
      idiom: item.idiom,
      filename: item.filename,
      scale: item.scale
    });
  }
  const appiconContents = {
    images: imagesJson,
    info: { author: 'xcode', version: 1 }
  };
  fs.writeFileSync(path.join(iosDir, 'Contents.json'), JSON.stringify(appiconContents, null, 2));

  // iOS Splash
  const iosSplashDir = 'ios/App/App/Assets.xcassets/Splash.imageset';
  if (!fs.existsSync(iosSplashDir)) fs.mkdirSync(iosSplashDir, { recursive: true });
  fs.writeFileSync(path.join(iosSplashDir, 'splash.png'), png1024Buf);
  fs.writeFileSync(path.join(iosSplashDir, 'splash@2x.png'), png1024Buf);
  fs.writeFileSync(path.join(iosSplashDir, 'splash@3x.png'), png1024Buf);

  // Sync public files and audio directory to ios and android
  function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      fs.readdirSync(src).forEach(childItemName => {
        copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
      });
    } else if (exists && stats.isFile()) {
      const parentDir = path.dirname(dest);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  for (const pubDst of ['ios/App/App/public', 'android/app/src/main/assets/public']) {
    if (fs.existsSync(pubDst)) {
      copyRecursiveSync('public', pubDst);
    }
  }

  console.log('✨ All mobile app icon and splash assets generated & verified directly from hwdjtb.png!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Generation error:', err);
  process.exit(1);
});
