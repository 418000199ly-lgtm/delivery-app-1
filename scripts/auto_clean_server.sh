#!/bin/bash
# ==============================================================================
# 黑丸代驾 - 阿里云服务器每2天自动瘦身与磁盘清理脚本 (每天中午10:00执行 / 2天周期)
# ==============================================================================

echo "---------------------------------------------------------"
echo "▶ 开始执行定时清理任务: $(date '+%Y-%m-%d %H:%M:%S')"
echo "---------------------------------------------------------"

# 1. 清理并截断 Nginx 站点访问与错误日志 (保留文件与权限，清空内容释放数GB空间)
if [ -d "/www/wwwlogs" ]; then
    echo "正在清理 Nginx 站点访问日志..."
    find /www/wwwlogs/ -name "*.log" -type f -exec truncate -s 0 {} \; 2>/dev/null
    find /www/wwwlogs/ -name "*.log.*" -type f -delete 2>/dev/null
    find /www/wwwlogs/ -name "*.gz" -type f -delete 2>/dev/null
    echo "✓ Nginx 访问日志已安全截断并清空。"
fi

# 2. 清理 PM2 / Node.js 运行日志
if command -v pm2 &> /dev/null; then
    echo "正在清理 PM2 进程运行日志..."
    pm2 flush 2>/dev/null
    echo "✓ PM2 日志已清空。"
fi

if [ -d "/root/.pm2/logs" ]; then
    find /root/.pm2/logs/ -name "*.log" -type f -exec truncate -s 0 {} \; 2>/dev/null
fi

# 3. 清理 Linux 系统 journal 运行日志 (保留2天以内)
if command -v journalctl &> /dev/null; then
    echo "正在清理系统 Journal 日志 (保留2天)..."
    journalctl --vacuum-time=2d 2>/dev/null
    journalctl --vacuum-size=100M 2>/dev/null
    echo "✓ 系统日志已瘦身。"
fi

# 4. 清理 npm 缓存与 /tmp 临时构建文件
echo "正在清理临时缓存文件..."
npm cache clean --force 2>/dev/null
rm -rf /tmp/npm-* /tmp/v8-compile-cache-* /tmp/core-js-* 2>/dev/null
find /tmp/ -type f -name "*.tmp" -mtime +1 -delete 2>/dev/null
find /tmp/ -type f -name "*.zip" -mtime +1 -delete 2>/dev/null
echo "✓ 临时缓存已清理。"

# 5. 清理 MySQL 二进制日志 (Binlog，如果开启了本地 MySQL)
if command -v mysql &> /dev/null; then
    echo "检查并清理 MySQL 过期 binlog..."
    # 尝试使用宝塔默认或者 root 权限清理 2 天前的二进制日志
    mysql -e "PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 2 DAY);" 2>/dev/null || true
fi

# 6. 显示当前磁盘使用情况
echo "---------------------------------------------------------"
echo "✓ 磁盘清理任务已完成！当前最新磁盘状态:"
df -h / | awk 'NR==1 || NR==2'
echo "---------------------------------------------------------"
