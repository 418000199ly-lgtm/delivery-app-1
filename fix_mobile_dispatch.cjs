const fs = require('fs');

const dFile = fs.readFileSync('src/components/MobileDispatchValetOrder.tsx', 'utf8');

const brokenRegex = /\/\/ Handle Image Upload for Payment QR with Auto-compression & PNG conversion\n  const handleFileUpload = async \(e: React.ChangeEvent<HTMLInputElement>\) => {[\s\S]*?alert\('图片处理失败，请重试'\);\n    }\n  };\n\n  \/\/ Handle Image Upload for Payment QR with Auto-compression & PNG conversion/m;

const replacement = `  // Handle Image Upload for Payment QR with Auto-compression & PNG conversion`;

if(brokenRegex.test(dFile)) {
  fs.writeFileSync('src/components/MobileDispatchValetOrder.tsx', dFile.replace(brokenRegex, replacement));
  console.log('Fixed MobileDispatchValetOrder.tsx');
} else {
  console.log('Regex did not match');
}
