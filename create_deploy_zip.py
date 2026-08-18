import os
import zipfile
import tarfile
import shutil
import subprocess

print("=== Starting Perfect Baota Deployment Package Generation ===")

# 1. Run build
try:
    print("Executing npm run build...")
    subprocess.run(["npm", "run", "build"], check=True)
except Exception as e:
    print(f"Build note: {e}")

# 2. Copy server.cjs to server.js for zero-setup Node execution in Baota Panel
if os.path.exists("dist/server.cjs"):
    shutil.copy("dist/server.cjs", "server.js")
    if os.path.exists("dist/server.cjs.map"):
        shutil.copy("dist/server.cjs.map", "server.js.map")

# 3. Create ecosystem.config.js for Baota PM2 Manager
ecosystem_content = """module.exports = {
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
"""
with open('ecosystem.config.js', 'w', encoding='utf-8') as f:
    f.write(ecosystem_content)

# 4. Create README_BAOTA.md
readme_content = """# 🚗 黑湾代驾MAX平台 - 阿里云宝塔面板一键部署指南

## 核心特性：
- **完全中国大陆本地化运行**：已完全切断 Firebase、Cloudflare 等国外被墙 API 依赖。
- **内置零配置服务端**：直接运行 `node server.js` 即可启动独立全栈服务端。
- **包含了全套功能模块**：商户代叫（手机网页版）、乘客自助端（代开单）、3分钟二维码防伪超时失效、非微信支付宝/未开会员拦截、管理后台及 MySQL 数据持久化。

---

## 宝塔面板快速部署步骤（只需3分钟）：

1. **准备宝塔环境**：
   - 在宝塔面板【软件商店】安装：
     - **Node.js 版本管理器**（推荐安装 Node.js 18.x 或 20.x）
     - **PM2 管理器**
     - **MySQL 5.7 / 8.0**（如需持久化数据库）

2. **上传与解压**：
   - 进入宝塔面板【文件】-> 您的网站根目录。
   - 上传 `daijia_deploy.zip` 并在线解压（0解压错误，完美兼容 Linux unzip）。

3. **配置环境变量**：
   - 复制 `.env.example` 并重命名为 `.env`。
   - 打开 `.env` 填写您的宝塔 MySQL 数据库连接参数（MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE）。

4. **添加 Node.js 项目并启动**：
   - 进入宝塔【网站】-> 【Node项目】-> 【添加Node项目】：
     - **项目路径**：选择网站根目录
     - **启动文件**：选择 `server.js`
     - **运行环境**：选择 Node 18+
     - **项目名称**：`daijia-app`
     - **端口**：`3000`
   - 点击【提交】后，在项目列表中点击【模块/依赖】执行 `npm install --production`（或依赖包安装）。
   - 点击【启动】。

5. **配置域名反向代理**：
   - 进入宝塔【网站设置】-> 【反向代理】-> 【添加反向代理】：
     - **代理名称**：`daijia-proxy`
     - **目标URL**：`http://127.0.0.1:3000`
     - **发送域名**：`$host`
   - 保存后即可使用您的域名直接访问代驾平台！
"""
with open('README_BAOTA.md', 'w', encoding='utf-8') as f:
    f.write(readme_content)

# Define exact file & directory list for inclusion
include_items = [
    'src',
    'public',
    'dist',
    'server.js',
    'server.js.map',
    'server.ts',
    'package.json',
    'package-lock.json',
    '.env.example',
    'ecosystem.config.js',
    'README_BAOTA.md',
    'ALIYUN_DEPLOY_GUIDE.md',
    'aliyun_passenger_deploy.html',
    'passenger_order.html',
    'hwdjtb.png',
    'vip_banner.jpg',
    'welcome_bg.jpg',
    'capacitor.config.json',
    'tsconfig.json',
    'vite.config.ts',
    'tailwind.config.js',
    'postcss.config.js',
    'metadata.json'
]

zip_filename = 'daijia_deploy.zip'
tar_filename = 'daijia_deploy.tar.gz'

if os.path.exists(zip_filename):
    os.remove(zip_filename)
if os.path.exists(tar_filename):
    os.remove(tar_filename)

def add_to_zip(zipf, full_path, archive_name):
    """Add a file or dir to zip with proper Unix permissions for Baota unzip"""
    if os.path.isdir(full_path):
        zinfo = zipfile.ZipInfo(archive_name + '/')
        zinfo.external_attr = 0o755 << 16 | 0x10  # rwxr-xr-x + directory flag
        zipf.writestr(zinfo, '')
    else:
        with open(full_path, 'rb') as f:
            data = f.read()
        zinfo = zipfile.ZipInfo(archive_name)
        zinfo.compress_type = zipfile.ZIP_DEFLATED
        zinfo.external_attr = 0o644 << 16  # rw-r--r--
        zipf.writestr(zinfo, data)

print(f"Creating {zip_filename} with Linux permissions...")
with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for item in include_items:
        if os.path.exists(item):
            if os.path.isdir(item):
                add_to_zip(zipf, item, item)
                for root, dirs, files in os.walk(item):
                    if 'node_modules' in root or '.git' in root:
                        continue
                    for d in dirs:
                        if d in ['node_modules', '.git']:
                            continue
                        dir_path = os.path.join(root, d)
                        rel_path = os.path.relpath(dir_path, os.getcwd())
                        add_to_zip(zipf, dir_path, rel_path)
                    for file in files:
                        if file.endswith('.zip') or file.endswith('.gz'):
                            continue
                        file_path = os.path.join(root, file)
                        rel_path = os.path.relpath(file_path, os.getcwd())
                        add_to_zip(zipf, file_path, rel_path)
            else:
                add_to_zip(zipf, item, item)

print(f"Creating {tar_filename}...")
with tarfile.open(tar_filename, 'w:gz') as tarf:
    for item in include_items:
        if os.path.exists(item):
            if os.path.isdir(item):
                for root, dirs, files in os.walk(item):
                    if 'node_modules' in root or '.git' in root:
                        continue
                    for file in files:
                        if file.endswith('.zip') or file.endswith('.gz'):
                            continue
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, os.getcwd())
                        tarf.add(full_path, rel_path)
            else:
                tarf.add(item, item)

# Also copy to dist/daijia_deploy.zip for static fallback
if os.path.exists('dist'):
    shutil.copy(zip_filename, os.path.join('dist', zip_filename))
    shutil.copy(tar_filename, os.path.join('dist', tar_filename))

print("=== Baota Deployment Package Created Successfully ===")
print(f"Zip size: {os.path.getsize(zip_filename)} bytes ({os.path.getsize(zip_filename)/1024/1024:.2f} MB)")
print(f"Tar.gz size: {os.path.getsize(tar_filename)} bytes ({os.path.getsize(tar_filename)/1024/1024:.2f} MB)")
