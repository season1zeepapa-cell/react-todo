// PM2 프로세스 관리 설정 파일
// PM2는 Node.js 앱을 백그라운드에서 실행하고,
// 크래시 시 자동 재시작해주는 프로세스 매니저입니다.
//
// 사용법:
//   pm2 start ecosystem.config.js    — 앱 시작
//   pm2 restart react-todo           — 앱 재시작
//   pm2 logs react-todo              — 로그 확인
//   pm2 stop react-todo              — 앱 중지

module.exports = {
  apps: [{
    // 앱 이름: PM2에서 이 이름으로 관리합니다
    name: 'react-todo',

    // 실행할 스크립트 경로
    script: 'server.js',

    // 프로덕션 환경변수
    env: {
      NODE_ENV: 'production'
    },

    // 크래시 시 자동 재시작
    autorestart: true,

    // 메모리가 300MB 초과하면 자동 재시작 (메모리 누수 방지)
    max_memory_restart: '300M',

    // 로그 파일 경로
    error_file: './logs/error.log',
    out_file: './logs/output.log',

    // 로그에 시간 표시
    time: true
  }]
};
