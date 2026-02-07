#!/bin/bash
# ==============================================
# 배포 스크립트 — Lightsail 인스턴스에서 실행됩니다
# GitHub Actions가 SSH로 접속하여 이 스크립트를 실행합니다
#
# 동작 흐름:
# 1. 프로젝트 폴더로 이동
# 2. Git에서 최신 코드 가져오기 (git pull)
# 3. 서버 의존성 설치 (npm install)
# 4. PM2로 서버 재시작
# ==============================================

set -e  # 에러 발생 시 즉시 스크립트 중단

# 프로젝트가 설치된 경로 (Lightsail 인스턴스 내 경로)
APP_DIR="/home/ubuntu/react-todo"

echo "🚀 배포를 시작합니다..."

# 1단계: 프로젝트 폴더로 이동
cd "$APP_DIR"
echo "📂 프로젝트 폴더: $APP_DIR"

# 2단계: 최신 코드 가져오기
echo "📥 최신 코드를 가져오는 중..."
git pull origin main

# 3단계: 의존성 설치
echo "📦 의존성 설치 중..."
npm install --production

# 4단계: PM2로 서버 재시작
echo "🔄 서버를 재시작하는 중..."
pm2 restart ecosystem.config.js --env production 2>/dev/null || pm2 start ecosystem.config.js --env production

# 5단계: PM2 프로세스 목록 저장 (서버 재부팅 시 자동 시작을 위해)
pm2 save

echo "✅ 배포가 완료되었습니다!"
echo "📊 현재 PM2 상태:"
pm2 list
