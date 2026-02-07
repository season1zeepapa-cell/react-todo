# React 투두앱

React + Express + PostgreSQL 기반의 투두앱입니다. JWT 인증으로 사용자별 할 일을 관리합니다.

## 프로젝트 구조

```
react-todo/
├── index.html          # 프론트엔드 (React 18 + Tailwind CSS, CDN)
├── server.js           # 백엔드 (Express 5 + PostgreSQL)
├── package.json        # Node.js 의존성 설정
├── .env                # 환경변수 (Git 제외)
├── ecosystem.config.js # PM2 프로세스 관리 설정
├── scripts/deploy.sh   # 배포 스크립트
└── CLAUDE.md           # 개발 가이드 (상세 아키텍처 문서)
```

## 시작하기

### 1단계: 환경변수 설정

`.env` 파일을 프로젝트 루트에 생성합니다:

```env
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=랜덤_시크릿_키
PORT=3000
```

`JWT_SECRET`은 다음 명령어로 생성할 수 있습니다:
```bash
openssl rand -hex 32
```

### 2단계: 의존성 설치 및 서버 실행

```bash
npm install
npm start
```

서버가 시작되면 `http://localhost:3000`에서 앱을 사용할 수 있습니다.

## 기술 스택

- **프론트엔드**: React 18 (CDN) + Tailwind CSS — 빌드 도구 없음
- **백엔드**: Node.js + Express 5
- **데이터베이스**: PostgreSQL (pg 라이브러리로 직접 연결)
- **인증**: bcrypt + JWT (7일 유효)
- **배포**: GitHub Actions → AWS Lightsail + PM2

## API 엔드포인트

### 인증 (공개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/register` | 회원가입 |
| POST | `/api/auth/login` | 로그인 |
| GET | `/api/auth/me` | 현재 사용자 확인 (토큰 필요) |

### 투두 (인증 필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/todos` | 할 일 목록 조회 |
| POST | `/api/todos` | 할 일 추가 |
| PATCH | `/api/todos/:id` | 완료 상태 변경 |
| DELETE | `/api/todos/:id` | 할 일 삭제 |

## 문제 해결

- **서버 시작 안 됨**: `.env`에 `DATABASE_URL`, `JWT_SECRET` 설정 확인
- **DB 연결 실패**: DATABASE_URL 형식 확인, Supabase 프로젝트 Paused 여부 확인
- **401 에러**: 토큰 만료 → 재로그인
- **포트 충돌**: `lsof -i :3000`으로 확인

## 라이선스

MIT License
