#!/bin/bash

# 修复部署目录权限的脚本
# 使用方法: bash fix-permissions.sh /www/wwwroot/airdrop-lite ubuntu

DEPLOY_DIR="${1:-/www/wwwroot/airdrop-lite}"
USER="${2:-ubuntu}"

if [ ! -d "$DEPLOY_DIR" ]; then
    echo "❌ 错误: 目录不存在: $DEPLOY_DIR"
    exit 1
fi

echo "=========================================="
echo "修复部署目录权限"
echo "=========================================="
echo "目录: $DEPLOY_DIR"
echo "用户: $USER"
echo ""

# 检查当前用户
CURRENT_USER=$(whoami)
echo "当前用户: $CURRENT_USER"
echo ""

# 修复目录所有者
echo "正在修复目录所有者..."
sudo chown -R $USER:$USER "$DEPLOY_DIR"
if [ $? -eq 0 ]; then
    echo "✓ 目录所有者已修复"
else
    echo "❌ 修复失败，请检查是否有 sudo 权限"
    exit 1
fi

# 修复目录权限
echo "正在修复目录权限..."
sudo chmod -R 755 "$DEPLOY_DIR"
if [ $? -eq 0 ]; then
    echo "✓ 目录权限已修复"
else
    echo "❌ 修复失败"
    exit 1
fi

# 确保用户可以写入
echo "正在设置写入权限..."
sudo chmod -R u+w "$DEPLOY_DIR"
if [ $? -eq 0 ]; then
    echo "✓ 写入权限已设置"
else
    echo "❌ 设置失败"
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ 权限修复完成！"
echo "=========================================="
echo ""
echo "现在可以运行:"
echo "  cd $DEPLOY_DIR"
echo "  npm install --production"
echo ""



