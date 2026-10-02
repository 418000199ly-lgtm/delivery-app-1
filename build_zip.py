import os
import zipfile
import shutil

print("Building daijia_deploy.zip...")

# Copy compiled server.cjs to server.js for zero-setup execution
if os.path.exists("dist/server.cjs"):
    shutil.copy("dist/server.cjs", "server.js")
    if os.path.exists("dist/server.cjs.map"):
        shutil.copy("dist/server.cjs.map", "server.js.map")

# Create PM2 ecosystem config
with open('ecosystem.config.js', 'w', encoding='utf-8') as f:
    f.write("""module.exports = {
  apps: [
    {
      name: 'daijia-app',
      script: './server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
""")

# Create Baota deployment guide
with open('README_BAOTA.md', 'w', encoding='utf-8') as f:
    f.write("""# 🚗 黑湾代驾MAX平台 - 宝塔面板部署指南

1. **环境要求**：
   - 宝塔面板 + Node.js 版本管理器 (安装 Node.js 18.x 或 20.x)
   - MySQL 5.7 / 8.0 (可选，用于云端持久化存储)
   - PM2 管理器

2. **部署步骤**：
   - 在宝塔新建网站，将本压缩包解压到网站根目录。
   - 在宝塔【Node.js项目】中添加项目：
     - 项目路径: 网站根目录
     - 启动文件: `server.js`
     - 运行环境: Node 18+
     - 项目名称: `daijia-app`
     - 端口: 3000
   - 点击添加后，在项目管理中安装依赖 (`npm install --production`) 并启动。
   - 配置反向代理: 目标 URL `http://127.0.0.1:3000`。
""")

include_dirs = ['src', 'public', 'dist', 'uploads', 'scripts']
include_files = [
    'server.js', 'server.js.map', 'server.ts', 'local_db.json', 'package.json', 'package-lock.json', 
    '.env.example', 'ecosystem.config.js', 'README_BAOTA.md',
    'tsconfig.json', 'vite.config.ts', 'tailwind.config.js', 'metadata.json',
    'passenger_order.html', 'capacitor.config.json', 'capacitor.config.ts'
]

with zipfile.ZipFile('daijia_deploy.zip', 'w', zipfile.ZIP_DEFLATED) as zipf:
    for d in include_dirs:
        if os.path.exists(d):
            for root, dirs, files in os.walk(d):
                if 'node_modules' in root or '.git' in root:
                    continue
                for file in files:
                    if file.endswith('.zip') or file.endswith('.gz'):
                        continue
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, os.getcwd())
                    zipf.write(full_path, rel_path)
    for f in include_files:
        if os.path.exists(f):
            zipf.write(f, f)

if os.path.exists('dist'):
    shutil.copy('daijia_deploy.zip', os.path.join('dist', 'daijia_deploy.zip'))
if os.path.exists('public'):
    shutil.copy('daijia_deploy.zip', os.path.join('public', 'daijia_deploy.zip'))

print("daijia_deploy.zip created successfully! Size:", os.path.getsize('daijia_deploy.zip'), "bytes")
