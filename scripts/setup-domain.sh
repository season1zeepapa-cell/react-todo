#!/bin/bash
# ==============================================
# 도메인 + HTTPS 설정 스크립트
# Lightsail 인스턴스에서 직접 실행합니다 (1회만 실행하면 됨)
#
# 이 스크립트가 하는 일:
# 1. Nginx 설치 (웹 서버 / 리버스 프록시)
# 2. Nginx 설정 파일 생성 (todo.aifac.click → localhost:3000)
# 3. Let's Encrypt SSL 인증서 발급 (HTTPS 적용)
#
# 사용법:
#   sudo bash /home/ubuntu/react-todo/scripts/setup-domain.sh
# ==============================================

set -e  # 에러 발생 시 즉시 중단

# ========== 설정값 ==========
DOMAIN="todo.aifac.click"
APP_PORT=3000
EMAIL="admin@aifac.click"  # Let's Encrypt 인증서 만료 알림용 이메일

echo "=============================================="
echo "🌐 도메인 설정을 시작합니다: $DOMAIN"
echo "=============================================="

# ========== 1단계: Nginx 설치 ==========
echo ""
echo "📦 1단계: Nginx 설치 중..."
apt-get update -y
apt-get install -y nginx

# ========== 2단계: Nginx 설정 파일 생성 ==========
echo ""
echo "📝 2단계: Nginx 설정 파일 생성 중..."

# 기존 기본 설정 비활성화
rm -f /etc/nginx/sites-enabled/default

# 새 설정 파일 생성
cat > /etc/nginx/sites-available/$DOMAIN << 'NGINX_CONF'
# ==============================================
# Nginx 리버스 프록시 설정
# todo.aifac.click으로 들어오는 요청을 → localhost:3000으로 전달
# ==============================================

server {
    listen 80;
    server_name todo.aifac.click;

    # Let's Encrypt 인증서 발급 시 사용되는 경로
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # 모든 요청을 Node.js 서버(Express)로 전달
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # WebSocket 지원 (향후 실시간 기능 추가 시 필요)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        # 원래 요청자의 정보를 서버에 전달
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 캐시 비활성화 (항상 최신 데이터 전달)
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_CONF

# 심볼릭 링크 생성 (sites-available → sites-enabled)
# Nginx는 sites-enabled 폴더의 설정만 읽습니다
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN

# Nginx 설정 문법 검사
echo "🔍 Nginx 설정 검사 중..."
nginx -t

# Nginx 재시작
systemctl restart nginx
systemctl enable nginx
echo "✅ Nginx 설정 완료!"

# ========== 3단계: SSL 인증서 발급 (HTTPS) ==========
echo ""
echo "🔒 3단계: Let's Encrypt SSL 인증서 발급 중..."

# Certbot 설치 (Let's Encrypt 인증서 발급 도구)
apt-get install -y certbot python3-certbot-nginx

# SSL 인증서 발급 + Nginx 자동 설정
# --non-interactive: 대화형 프롬프트 없이 자동 실행
# --agree-tos: 이용약관 동의
# --redirect: HTTP → HTTPS 자동 리다이렉트 설정
certbot --nginx \
    -d $DOMAIN \
    --email $EMAIL \
    --non-interactive \
    --agree-tos \
    --redirect

echo ""
echo "=============================================="
echo "✅ 도메인 설정이 완료되었습니다!"
echo ""
echo "🌐 접속 주소: https://$DOMAIN"
echo "🔒 HTTPS가 자동으로 적용되었습니다"
echo "🔄 인증서는 자동으로 갱신됩니다 (90일마다)"
echo "=============================================="
