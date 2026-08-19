import fs from 'fs';
import path from 'path';

const mascotData = fs.readFileSync('src/assets/images/driver_mascot_1781782355270.jpg');
const avatarData = fs.readFileSync('src/assets/images/driver_avatar_1784017528877.jpg');

fs.writeFileSync('public/driver_mascot.jpg', mascotData);
fs.writeFileSync('public/t041a040bace9bbe659.jpg', mascotData);
fs.writeFileSync('src/assets/images/t041a040bace9bbe659.jpg', mascotData);
fs.writeFileSync('public/driver_avatar.jpg', avatarData);

const mascotB64 = mascotData.toString('base64');
const avatarB64 = avatarData.toString('base64');

const tsContent = `// Auto-generated Base64 and offline static assets for App packaging
export const DRIVER_MASCOT_BASE64 = "data:image/jpeg;base64,${mascotB64}";
export const DRIVER_AVATAR_BASE64 = "data:image/jpeg;base64,${avatarB64}";
export const DRIVER_MASCOT_PATH = "/t041a040bace9bbe659.jpg";
export const DRIVER_AVATAR_PATH = "/driver_avatar.jpg";
`;

fs.writeFileSync('src/assets/images/driverImageConstants.ts', tsContent);
console.log('Done bundling driver image constants!');
