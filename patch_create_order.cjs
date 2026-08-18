const fs = require('fs');
let content = fs.readFileSync('src/components/CreateOrderView.tsx', 'utf8');
content = content.replace(/let baseOrigin = "[^"]+";[\s\S]*?baseOrigin = urlObj\.origin;[\s\S]*?\} catch \(e\) \{[\s\S]*?\}[\s\S]*?\}[\s\S]*?\}/, 'let baseOrigin = "https://lyheiwandaijiamax.com";');
fs.writeFileSync('src/components/CreateOrderView.tsx', content);
