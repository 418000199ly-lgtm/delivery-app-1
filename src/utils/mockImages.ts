// Custom high-fidelity mock image database representing Image 3 photo album
export interface AlbumPhoto {
  id: string;
  name: string;
  dataUrl: string;
  type: 'qr' | 'scooter' | 'person' | 'other';
}

const svgToDataUrl = (svgContent: string): string => {
  try {
    const base64 = btoa(unescape(encodeURIComponent(svgContent.trim())));
    return `data:image/svg+xml;base64,${base64}`;
  } catch (e) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
  }
};

// 1. WeChat Green QR Code (Top-Left, First QR code in Image 3)
const wechatGreenQrSvg = `
<svg viewBox="50 45 200 200" xmlns="http://www.w3.org/2000/svg">
  <rect x="50" y="45" width="200" height="200" fill="#ffffff" />
  
  {/* Finder Patterns */}
  <rect x="55" y="50" width="45" height="45" fill="#111111" rx="6" />
  <rect x="63" y="58" width="29" height="29" fill="#ffffff" rx="3" />
  <rect x="71" y="66" width="13" height="13" fill="#111111" rx="1.5" />
  
  <rect x="200" y="50" width="45" height="45" fill="#111111" rx="6" />
  <rect x="208" y="58" width="29" height="29" fill="#ffffff" rx="3" />
  <rect x="216" y="66" width="13" height="13" fill="#111111" rx="1.5" />
  
  <rect x="55" y="195" width="45" height="45" fill="#111111" rx="6" />
  <rect x="63" y="203" width="29" height="29" fill="#ffffff" rx="3" />
  <rect x="71" y="211" width="13" height="13" fill="#111111" rx="1.5" />
  
  {/* QR Code grid decoration */}
  <rect x="110" y="50" width="10" height="10" fill="#111111" />
  <rect x="130" y="50" width="20" height="10" fill="#111111" />
  <rect x="160" y="50" width="10" height="20" fill="#111111" />
  <rect x="180" y="50" width="10" height="10" fill="#111111" />
  
  <rect x="110" y="70" width="20" height="10" fill="#111111" />
  <rect x="140" y="70" width="10" height="10" fill="#111111" />
  <rect x="160" y="80" width="10" height="20" fill="#111111" />
  <rect x="180" y="70" width="10" height="10" fill="#111111" />
  
  <rect x="110" y="90" width="10" height="20" fill="#111111" />
  <rect x="130" y="90" width="30" height="10" fill="#111111" />
  <rect x="170" y="90" width="10" height="10" fill="#111111" />
  <rect x="180" y="100" width="10" height="10" fill="#111111" />
  
  <rect x="55" y="110" width="10" height="20" fill="#111111" />
  <rect x="75" y="110" width="20" height="10" fill="#111111" />
  <rect x="105" y="110" width="10" height="10" fill="#111111" />
  <rect x="125" y="110" width="20" height="20" fill="#111111" />
  <rect x="155" y="110" width="10" height="10" fill="#111111" />
  <rect x="175" y="110" width="30" height="10" fill="#111111" />
  <rect x="215" y="110" width="10" height="20" fill="#111111" />
  <rect x="235" y="110" width="20" height="10" fill="#111111" />
  
  <rect x="55" y="140" width="20" height="10" fill="#111111" />
  <rect x="85" y="140" width="10" height="10" fill="#111111" />
  <rect x="105" y="140" width="10" height="20" fill="#111111" />
  <rect x="125" y="140" width="30" height="10" fill="#111111" />
  <rect x="175" y="140" width="10" height="10" fill="#111111" />
  <rect x="195" y="140" width="20" height="20" fill="#111111" />
  <rect x="225" y="140" width="10" height="10" fill="#111111" />
  <rect x="240" y="140" width="15" height="10" fill="#111111" />
  
  <rect x="55" y="165" width="10" height="10" fill="#111111" />
  <rect x="75" y="165" width="20" height="20" fill="#111111" />
  <rect x="105" y="165" width="10" height="10" fill="#111111" />
  <rect x="120" y="165" width="10" height="30" fill="#111111" />
  <rect x="140" y="165" width="20" height="10" fill="#111111" />
  <rect x="170" y="165" width="10" height="10" fill="#111111" />
  <rect x="185" y="165" width="30" height="10" fill="#111111" />
  <rect x="225" y="165" width="20" height="20" fill="#111111" />
  <rect x="110" y="200" width="20" height="10" fill="#111111" />
  <rect x="140" y="200" width="10" height="30" fill="#111111" />
  <rect x="160" y="210" width="30" height="10" fill="#111111" />
  <rect x="200" y="200" width="10" height="15" fill="#111111" />
  <rect x="220" y="220" width="25" height="10" fill="#111111" />

  {/* Small WeChat style Profile Tag inside physical QR Center */}
  <rect x="135" y="135" width="30" height="30" rx="6" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" />
  <rect x="138" y="138" width="24" height="24" rx="4" fill="#07C160" />
  {/* Little profile icon inside green */}
  <rect x="146" y="142" width="8" height="8" rx="4" fill="#ffffff" />
  <path d="M 142 155 Q 150 148 158 155 Z" fill="#ffffff" />
</svg>
`;

// 2. Avatar Black-White QR code (Second QR code in Image 3)
const portraitQrSvg = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="300" fill="#f8fafc" />
  <rect x="20" y="20" width="260" height="260" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" />
  
  {/* Finder Patterns */}
  <rect x="40" y="40" width="50" height="50" fill="#000000" rx="5" />
  <rect x="49" y="49" width="32" height="32" fill="#ffffff" rx="3" />
  <rect x="57" y="57" width="16" height="16" fill="#000000" rx="2" />
  
  <rect x="210" y="40" width="50" height="50" fill="#000000" rx="5" />
  <rect x="219" y="49" width="32" height="32" fill="#ffffff" rx="3" />
  <rect x="227" y="57" width="16" height="16" fill="#000000" rx="2" />
  
  <rect x="40" y="210" width="50" height="50" fill="#000000" rx="5" />
  <rect x="49" y="219" width="32" height="32" fill="#ffffff" rx="3" />
  <rect x="57" y="227" width="16" height="16" fill="#000000" rx="2" />

  {/* Dense QR structures */}
  <path d="M95 40 h110 v10 h-110 z M100 65 h40 v8 h-40 z M150 55 h30 v10 h-30 z M110 80 h80 v10 h-80 z" fill="#000000" />
  <path d="M40 95 h220 v8 h-220 z M40 115 h100 v10 h-100 z M150 110 h60 v10 h-60 z M220 115 h40 v8 h-40 z" fill="#000000" />
  <path d="M40 135 h60 v10 h-60 z M110 130 h80 v12 h-80 z M200 135 h60 v10 h-60 z" fill="#000000" />
  <path d="M40 155 h80 v10 h-80 z M130 160 h30 v8 h-30 z M170 155 h90 v10 h-90 z" fill="#000000" />
  <path d="M95 180 h165 v10 h-165 z M95 200 h40 v8 h-40 z M150 195 h110 v10 h-110 z" fill="#000000" />
  <path d="M95 220 h60 v10 h-60 z M165 215 h95 v10 h-95 z" fill="#000000" />
  <path d="M95 240 h165 v10 h-165 z" fill="#000000" />

  {/* Boy Portrait Center Logo */}
  <rect x="125" y="125" width="50" height="50" rx="25" fill="#ffffff" stroke="#e2e8f0" stroke-width="2" />
  {/* Cute cartoon portrait representation with green status check badge */}
  <g transform="translate(130, 130)">
    {/* Dark hair */}
    <path d="M 10 15 C 10 5, 30 5, 30 15 C 32 15, 32 20, 30 22 C 30 25, 28 32, 20 32 C 12 32, 10 25, 10 22 C 8 20, 8 15, 10 15 Z" fill="#2d3748" />
    {/* Skin and face */}
    <circle cx="20" cy="20" r="8" fill="#fed7d7" />
    <path d="M 15 15 C 15 8, 25 8, 25 15 Z" fill="#1a202c" /> {/* Hair bangs */}
    {/* Suit coat */}
    <path d="M 8 36 Q 20 28 32 36 L 32 40 L 8 40 Z" fill="#1a202c" />
    {/* White shirt */}
    <path d="M 17 31 L 23 31 L 20 38 Z" fill="#ffffff" />
  </g>
  {/* Green checkmark circle badge */}
  <circle cx="168" cy="168" r="8" fill="#07C160" />
  <path d="M 164 168 L 167 171 L 172 165" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>
`;

// 3. Electric Moped Side-Angle NIU Style (Image 3 First row 3rd image)
const scooter1Svg = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4a5568" />
      <stop offset="60%" stop-color="#718096" />
      <stop offset="100%" stop-color="#cbd5e0" />
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#sky)" />
  
  {/* Background leaves/wall */}
  <path d="M0 160 Q 80 150 150 170 Q 220 190 300 160 L 300 300 L 0 300 Z" fill="#2f3b4c" opacity="0.4" />
  <path d="M0 190 Q 120 180 200 210 Q 260 200 300 220 L 300 300 L 0 300 Z" fill="#1a202c" opacity="0.6" />

  {/* Electric Moped scooter silhouette */}
  <g transform="translate(40, 60)">
    {/* Wheels */}
    <circle cx="50" cy="140" r="32" fill="#1a202c" stroke="#4a5568" stroke-width="6" />
    <circle cx="50" cy="140" r="16" fill="#e2e8f0" stroke="#718096" stroke-width="4" />
    
    <circle cx="170" cy="140" r="32" fill="#1a202c" stroke="#4a5568" stroke-width="6" />
    <circle cx="170" cy="140" r="16" fill="#e2e8f0" stroke="#718096" stroke-width="4" />

    {/* Body / Mudguards */}
    <path d="M 25 125 Q 50 100 85 125 Z" fill="#1a202c" />
    <path d="M 145 125 Q 170 100 195 125 Z" fill="#1a202c" />

    {/* Frame, Chassis, Seat info */}
    <path d="M 50 140 L 90 70 L 140 70 L 170 140" stroke="#2d3748" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    
    {/* Cool NIU Blue/Grey main plastic chassis */}
    <path d="M 75 75 L 140 70 L 155 105 L 85 110 Z" fill="#506680" />
    {/* Highlight cyan/blue bar */}
    <path d="M 85 85 L 135 80" stroke="#00d8d6" stroke-width="4" stroke-linecap="round" />

    {/* Black leather saddle seat */}
    <path d="M 85 64 C 95 56, 135 56, 145 66 L 145 74 L 85 74 Z" fill="#1a202c" rx="4" />

    {/* Front handlebar stem and headlight */}
    <line x1="50" y1="140" x2="70" y2="35" stroke="#1a202c" stroke-width="8" stroke-linecap="round" />
    <circle cx="73" cy="35" r="12" fill="#000000" />
    {/* Glowing LED Halo Headlight */}
    <circle cx="76" cy="35" r="8" fill="#e2e8f0" stroke="#00d8d6" stroke-width="2" />

    {/* Handlebars */}
    <line x1="65" y1="25" x2="85" y2="30" stroke="#2d3748" stroke-width="4" stroke-linecap="round" />

    {/* Stand */}
    <line x1="110" y1="120" x2="95" y2="155" stroke="#1a202c" stroke-width="6" stroke-linecap="round" />
  </g>
</svg>
`;

// 4. Scooter Side View Moped Outdoor (Image 3 Second row, 1st and 2nd images)
const scooter2Svg = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="300" fill="#718096" />
  {/* Sunny asphalt road shadow */}
  <path d="M 0 200 L 300 180 L 300 300 L 0 300 Z" fill="#4a5568" />
  <ellipse cx="150" cy="230" rx="90" ry="12" fill="#2d3748" opacity="0.6" />

  {/* Side Scooter profile */}
  <g transform="translate(45, 70)">
    <circle cx="40" cy="120" r="28" fill="#1a202c" stroke="#4a5568" stroke-width="4" />
    <circle cx="160" cy="120" r="28" fill="#1a202c" stroke="#4a5568" stroke-width="4" />
    
    <path d="M 40 120 L 75 60 L 135 60 L 160 120 Z" fill="none" stroke="#2d3748" stroke-width="8" />
    {/* Dark grey body panels */}
    <path d="M 65 60 L 135 60 L 145 95 L 75 100 Z" fill="#2d3748" />
    <rect x="70" y="50" width="65" height="10" rx="3" fill="#1a202c" />
    
    {/* Fork stem to front handler */}
    <line x1="40" y1="120" x2="55" y2="30" stroke="#1a202c" stroke-width="6" />
    <circle cx="57" cy="30" r="10" fill="#ff5e57" /> {/* Red highlight accent */}
    <line x1="50" y1="22" x2="65" y2="25" stroke="#1a202c" stroke-width="4" stroke-linecap="round" />
  </g>
</svg>
`;

// 5. Pretty girl with sporty bra and chic jacket (Image 3 Second row 3rd image)
const girlPortraitSvg = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="300" fill="#ebd2c8" />
  {/* City blurred background elements */}
  <circle cx="50" cy="80" r="40" fill="#a0aec0" opacity="0.5" filter="blur(5px)" />
  <rect x="180" y="30" width="80" height="180" fill="#718096" opacity="0.4" />

  {/* Styled vector illustration representing the portrait of the girl in the trench coat & pink top */}
  <g transform="translate(60, 40)">
    {/* Hair back */}
    <path d="M 40 50 C 10 50, 10 160, 40 180 C 70 180, 140 140, 120 50 Z" fill="#2d3748" />
    
    {/* Neck & Shoulders */}
    <path d="M 75 110 L 105 110 L 120 180 L 60 180 Z" fill="#fbd38d" />
    
    {/* Face */}
    <path d="M 65 60 Q 55 100 80 115 Q 105 100 100 60 Z" fill="#fde047" opacity="0.8" />
    <path d="M 65 60 Q 55 100 80 115 Q 105 100 100 60 Z" fill="#ffebd7" />
    
    {/* Beautiful flowing brown hair detail */}
    <path d="M 65 30 Q 80 20 100 35 Q 115 50 110 80 Q 100 120 115 150" fill="none" stroke="#2d3748" stroke-width="15" stroke-linecap="round" />
    <path d="M 55 45 Q 60 30 75 35 Q 85 45 75 75 Q 65 110 55 140" fill="none" stroke="#2d3748" stroke-width="10" stroke-linecap="round" />

    {/* Pink top / bra straps */}
    <path d="M 72 135 L 108 135 L 115 180 L 65 180 Z" fill="#f48fb1" />
    <line x1="78" y1="115" x2="80" y2="135" stroke="#e91e63" stroke-width="2" />
    <line x1="102" y1="115" x2="100" y2="135" stroke="#e91e63" stroke-width="2" />

    {/* Stylish beige/white jacket drape (opened over shoulders) */}
    <path d="M 40 130 C 50 110 65 125 55 150 C 45 175 40 210 35 230" fill="none" stroke="#f7fafc" stroke-width="18" stroke-linecap="round" />
    <path d="M 140 130 C 130 110 115 125 125 150 C 135 175 140 210 145 230" fill="none" stroke="#f7fafc" stroke-width="18" stroke-linecap="round" />
  </g>
</svg>
`;

// 6. Advertising flyer card (Image 3 Fourth row 2nd image)
const adCardSvg = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="300" fill="#f68b1e" />
  
  {/* Top and Bottom banner style */}
  <rect x="15" y="15" width="270" height="270" rx="8" fill="#ffffff" />
  
  {/* Headline text container */}
  <rect x="25" y="30" width="250" height="45" rx="6" fill="#e53e3e" />
  <text x="150" y="60" font-family="'Microsoft YaHei', sans-serif" font-size="20" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">价格低 到离谱！</text>
  
  <rect x="25" y="85" width="250" height="45" rx="6" fill="#2b6cb0" />
  <text x="150" y="115" font-family="'Microsoft YaHei', sans-serif" font-size="20" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">服务好 到尖叫！</text>

  <text x="150" y="175" font-family="'Microsoft YaHei', sans-serif" font-size="14" font-weight="bold" fill="#ff7a00" text-anchor="middle">微信扫码 马上走！</text>
  
  {/* Big price offer */}
  <text x="150" y="235" font-family="'Microsoft YaHei', sans-serif" font-size="16" font-weight="bold" fill="#4a5568" text-anchor="middle">
    全城最低至 <tspan font-size="44" font-weight="900" fill="#e53e3e">27</tspan> 元起
  </text>
  
  {/* Footer dashed cutoffs */}
  <line x1="30" y1="260" x2="270" y2="260" stroke="#cbd5e0" stroke-width="2" stroke-dasharray="4,4" />
</svg>
`;

// 7. National Chinese ID Card mockup (Image 3 Fourth row 1st image)
const idCardSvg = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="300" fill="#cbd5e0" />
  {/* The typical Chinese ID card layout with national emblem on upper light-blue card */}
  <rect x="20" y="60" width="260" height="180" rx="12" fill="#e2ebf0" stroke="#a0aec0" stroke-width="2" />
  <path d="M 20 200 C 60 180, 180 230, 280 210 L 280 240 L 20 240 Z" fill="#9bc5df" opacity="0.3" />
  
  {/* Red National Emblem on upper left */}
  <circle cx="55" cy="110" r="22" fill="#e53e3e" />
  <circle cx="55" cy="110" r="18" fill="#e2ebf0" />
  <path d="M 50 102 L 60 102 L 58 118 L 52 118 Z" fill="#e53e3e" />
  <circle cx="55" cy="110" r="4" fill="#fde047" />

  {/* Card Title text */}
  <text x="90" y="105" font-family="'SimSun', serif" font-size="14" font-weight="900" fill="#1a202c" letter-spacing="1">中华人民共和国</text>
  <text x="90" y="125" font-family="'SimSun', serif" font-size="15" font-weight="900" fill="#1a202c" letter-spacing="3">居民身份证</text>

  <rect x="90" y="145" width="160" height="2" fill="#e53e3e" />

  {/* Card issuer details */}
  <text x="40" y="175" font-family="'Microsoft YaHei', sans-serif" font-size="9" font-weight="bold" fill="#4a5568">签发机关：银川市公安局兴庆区分局</text>
  <text x="40" y="195" font-family="'Microsoft YaHei', sans-serif" font-size="9" font-weight="bold" fill="#4a5568">有效期限：2025.09.23 - 2045.09.23</text>
</svg>
`;

// 8. Supercharger Powerbank (Image 3 Fifth row 3rd image)
const powerbankSvg = `
<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="300" fill="#2d3748" />
  {/* Shiny yellow dual power banks held in hand */}
  <g transform="translate(60, 40)">
    {/* Hand holding it simplified */}
    <path d="M 0 180 Q 40 140 80 180 T 160 180" fill="none" stroke="#fbd38d" stroke-width="24" stroke-linecap="round" />
    
    {/* Yellow power bank 1 */}
    <rect x="40" y="20" width="70" height="150" rx="12" fill="#fde047" stroke="#eab308" stroke-width="3" transform="rotate(-15, 75, 95)" />
    {/* Text and labels "超级快充 22.5W" */}
    <g transform="rotate(-15, 75, 95)">
      <text x="75" y="60" font-family="'Microsoft YaHei', sans-serif" font-size="10" font-weight="900" fill="#000000" text-anchor="middle">22.5W</text>
      <text x="75" y="85" font-family="'Microsoft YaHei', sans-serif" font-size="12" font-weight="bold" fill="#000000" text-anchor="middle" letter-spacing="1">超级快充</text>
      <circle cx="75" cy="120" r="14" fill="#000000" />
      <path d="M 72 120 L 77 112 L 75 120 L 78 120 L 73 128 L 75 120 Z" fill="#fde047" />
    </g>

    {/* Second power bank overlapping */}
    <rect x="90" y="40" width="70" height="150" rx="12" fill="#fde047" stroke="#eab308" stroke-width="3" transform="rotate(10, 125, 115)" opacity="0.9" />
  </g>
</svg>
`;

export const MOCK_ALBUM_PHOTOS: AlbumPhoto[] = [
  {
    id: 'photo_wechat_qr',
    name: '微信二维码 (ID:17)',
    dataUrl: svgToDataUrl(wechatGreenQrSvg),
    type: 'qr',
  },
  {
    id: 'photo_portrait_qr',
    name: '客服中心二维码',
    dataUrl: svgToDataUrl(portraitQrSvg),
    type: 'qr',
  },
  {
    id: 'photo_scooter_1',
    name: '新日电动车出行',
    dataUrl: svgToDataUrl(scooter1Svg),
    type: 'scooter',
  },
  {
    id: 'photo_scooter_2',
    name: '车辆备勤中',
    dataUrl: svgToDataUrl(scooter2Svg),
    type: 'scooter',
  },
  {
    id: 'photo_girl_portrait',
    name: '生活随手拍_1',
    dataUrl: svgToDataUrl(girlPortraitSvg),
    type: 'person',
  },
  {
    id: 'photo_ad_card',
    name: '宣传折页单页',
    dataUrl: svgToDataUrl(adCardSvg),
    type: 'other',
  },
  {
    id: 'photo_id_card',
    name: '居民身份证认证',
    dataUrl: svgToDataUrl(idCardSvg),
    type: 'other',
  },
  {
    id: 'photo_powerbank',
    name: '移动快充移动电源',
    dataUrl: svgToDataUrl(powerbankSvg),
    type: 'other',
  },
];
