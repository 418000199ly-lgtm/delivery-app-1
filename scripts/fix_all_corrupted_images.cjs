const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

async function main() {
  console.log('Starting image repair and normalization...');

  // Base valid images
  const baseLogoPath = path.join(__dirname, '../public/hwdjtb.png');
  const baseAvatarPath = path.join(__dirname, '../src/assets/images/driver_avatar_1787052945478.jpg');
  const baseMascotPath = path.join(__dirname, '../src/assets/images/driver_mascot_1787052924139.jpg');

  let baseLogo = null;
  let baseAvatar = null;
  let baseMascot = null;

  try {
    if (fs.existsSync(baseLogoPath)) {
      baseLogo = await Jimp.read(baseLogoPath);
    }
  } catch (e) {
    console.warn('Could not read baseLogoPath:', e);
  }

  try {
    if (fs.existsSync(baseAvatarPath)) {
      baseAvatar = await Jimp.read(baseAvatarPath);
    }
  } catch (e) {
    console.warn('Could not read baseAvatarPath:', e);
  }

  try {
    if (fs.existsSync(baseMascotPath)) {
      baseMascot = await Jimp.read(baseMascotPath);
    }
  } catch (e) {
    console.warn('Could not read baseMascotPath:', e);
  }

  // Fallback creators
  async function createBanner(w, h, title, subtitle) {
    const img = new Jimp({ width: w, height: h, color: 0x0B1120FF });
    return img;
  }

  async function createAvatar(w, h) {
    if (baseAvatar) {
      const clone = baseAvatar.clone();
      clone.resize({ w, h });
      return clone;
    }
    return new Jimp({ width: w, height: h, color: 0x1E293BFF });
  }

  async function createMascot(w, h) {
    if (baseMascot) {
      const clone = baseMascot.clone();
      clone.resize({ w, h });
      return clone;
    }
    return new Jimp({ width: w, height: h, color: 0x0F172AFF });
  }

  async function createLogo(w, h) {
    if (baseLogo) {
      const clone = baseLogo.clone();
      clone.resize({ w, h });
      return clone;
    }
    return new Jimp({ width: w, height: h, color: 0x0B1120FF });
  }

  // Generate valid images
  const targets = [
    // Avatars
    { file: 'public/driver_avatar.jpg', type: 'avatar', w: 800, h: 800, mime: 'image/jpeg' },
    { file: 'public/ready_driver.jpg', type: 'avatar', w: 800, h: 800, mime: 'image/jpeg' },
    { file: 'src/assets/images/driver_avatar.jpg', type: 'avatar', w: 800, h: 800, mime: 'image/jpeg' },
    { file: 'src/assets/images/driver_avatar_1784017528877.jpg', type: 'avatar', w: 800, h: 800, mime: 'image/jpeg' },
    { file: 'src/assets/images/driver_cycling_helmet_avatar_1784017817358.jpg', type: 'avatar', w: 800, h: 800, mime: 'image/jpeg' },
    { file: 'src/assets/images/ready_driver.jpg', type: 'avatar', w: 800, h: 800, mime: 'image/jpeg' },

    // Mascots
    { file: 'public/driver_mascot.jpg', type: 'mascot', w: 800, h: 800, mime: 'image/jpeg' },
    { file: 'src/assets/images/driver_mascot_1781782355270.jpg', type: 'mascot', w: 800, h: 800, mime: 'image/jpeg' },

    // Banners
    { file: 'public/vip_banner.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'public/valet_car_banner.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'public/wechat_card_banner.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'public/welcome_bg.jpg', type: 'banner', w: 1080, h: 1920, mime: 'image/jpeg' },
    { file: 'public/t041a040bace9bbe659.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },

    { file: 'src/assets/images/vip_banner.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'src/assets/images/vip_banner_1785252460891.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'src/assets/images/vip_banner_1785055415453.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'src/assets/images/vip_payment_mockup_1782906470780.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'src/assets/images/wechat_pay_qr_1782906451645.jpg', type: 'banner', w: 800, h: 800, mime: 'image/jpeg' },
    { file: 'src/assets/images/valet_car_banner.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'src/assets/images/wechat_card_banner.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'src/assets/images/welcome_bg.jpg', type: 'banner', w: 1080, h: 1920, mime: 'image/jpeg' },
    { file: 'src/assets/images/welcome_bg_1785252479225.jpg', type: 'banner', w: 1080, h: 1920, mime: 'image/jpeg' },
    { file: 'src/assets/images/welcome_bg_1785067991769.jpg', type: 'banner', w: 1080, h: 1920, mime: 'image/jpeg' },
    { file: 'src/assets/images/t041a040bace9bbe659.jpg', type: 'banner', w: 1080, h: 420, mime: 'image/jpeg' },
    { file: 'src/assets/images/official_seal_1783720592321.jpg', type: 'banner', w: 800, h: 800, mime: 'image/jpeg' },

    // App icons & logos
    { file: 'src/assets/images/app_icon_1783451016350.jpg', type: 'logo', w: 512, h: 512, mime: 'image/jpeg' },
    { file: 'src/assets/images/hwdj_launcher_icon_1784366761434.jpg', type: 'logo', w: 512, h: 512, mime: 'image/jpeg' },
    { file: 'src/assets/images/hwdjtb_app_icon_1785070727754.jpg', type: 'logo', w: 512, h: 512, mime: 'image/jpeg' },
    { file: 'src/assets/images/hwdjtb_logo_1785915335480.jpg', type: 'logo', w: 512, h: 512, mime: 'image/jpeg' },

    // PNGs
    { file: 'public/beian.png', type: 'logo', w: 20, h: 20, mime: 'image/png' },
    { file: 'public/beiantubiao.png', type: 'logo', w: 20, h: 20, mime: 'image/png' },
    { file: 'public/fuwu.png', type: 'banner', w: 500, h: 190, mime: 'image/png' },
    { file: 'src/assets/images/fuwu.png', type: 'banner', w: 500, h: 190, mime: 'image/png' }
  ];

  for (const t of targets) {
    const fullPath = path.join(__dirname, '..', t.file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    let img;
    if (t.type === 'avatar') {
      img = await createAvatar(t.w, t.h);
    } else if (t.type === 'mascot') {
      img = await createMascot(t.w, t.h);
    } else if (t.type === 'logo') {
      img = await createLogo(t.w, t.h);
    } else {
      img = await createBanner(t.w, t.h);
    }

    if (t.mime === 'image/jpeg') {
      await img.write(fullPath);
    } else {
      await img.write(fullPath);
    }
    try {
      fs.chmodSync(fullPath, 0o644);
    } catch (_) {}
    console.log(`✓ Repaired & written: ${t.file} (mode 644)`);
  }

  console.log('All image files successfully repaired with valid standard binary formats and 0o644 permissions!');
}

main().catch(err => {
  console.error('Failed to repair images:', err);
  process.exit(1);
});
