const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

async function migrateQrcodes() {
  const rootDir = process.cwd();
  const qrcodesDir = path.join(rootDir, 'uploads', 'qrcodes');
  const qrsDir = path.join(rootDir, 'uploads', 'qrs');

  if (!fs.existsSync(qrcodesDir)) fs.mkdirSync(qrcodesDir, { recursive: true });
  if (!fs.existsSync(qrsDir)) fs.mkdirSync(qrsDir, { recursive: true });

  const dbPath = path.join(rootDir, 'local_db.json');
  let dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  const collections = ['driver_users', 'squad_members', 'squad_applications', 'online_applications', 'dispatch_qrs', 'dispatch_qrcodes'];
  
  const allPhones = new Set();
  collections.forEach(col => {
    if (dbData[col]) {
      Object.keys(dbData[col]).forEach(k => {
        const phone = String(dbData[col][k]?.phone || dbData[col][k]?.phoneNumber || k).replace(/\D/g, '').trim();
        if (phone.length === 11) {
          allPhones.add(phone);
        }
      });
    }
  });

  console.log(`Found ${allPhones.size} driver accounts to process QR migration...`);

  let migratedCount = 0;
  let generatedCount = 0;

  for (const phone of allPhones) {
    const filename = `${phone}.png`;
    const targetPath = path.join(qrcodesDir, filename);
    const fallbackPath = path.join(qrsDir, filename);
    const qrUrl = `/uploads/qrcodes/${filename}`;

    // Find any existing base64 image data
    let existingBase64 = '';
    collections.forEach(col => {
      const item = dbData[col]?.[phone];
      if (item) {
        const candidate = item.wechatQrCode || item.qrCode || item.paymentQrCode || item.qrcode_url || '';
        if (typeof candidate === 'string' && candidate.startsWith('data:image')) {
          existingBase64 = candidate;
        }
      }
    });

    if (existingBase64) {
      const base64Data = existingBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(targetPath, buffer);
      fs.writeFileSync(fallbackPath, buffer);
      migratedCount++;

      collections.forEach(col => {
        if (dbData[col] && dbData[col][phone]) {
          dbData[col][phone].qrcode_url = qrUrl;
          dbData[col][phone].wechatQrCode = qrUrl;
          dbData[col][phone].qrCode = qrUrl;
        }
      });
    } else {
      // Do not auto-generate green QR codes! Drivers must upload their own real QR or leave empty.
      collections.forEach(col => {
        if (dbData[col] && dbData[col][phone]) {
          dbData[col][phone].qrcode_url = '';
          dbData[col][phone].wechatQrCode = '';
          dbData[col][phone].qrCode = '';
        }
      });
    }
  }

  fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
  console.log(`Migration Complete! Migrated Base64 images: ${migratedCount}, Generated standard disk PNGs: ${generatedCount}`);
  console.log(`Total images on disk in /uploads/qrcodes: ${fs.readdirSync(qrcodesDir).length}`);
}

migrateQrcodes().catch(console.error);
