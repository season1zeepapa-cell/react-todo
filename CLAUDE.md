# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

React + Express를 사용한 투두앱으로, **PostgreSQL 직접 연결 + JWT 인증** 방식을 사용합니다.
- 프론트엔드: React 18 (CDN) + Tailwind CSS — 빌드 도구 없음
- 백엔드: Node.js + Express 5 + PostgreSQL (pg 라이브러리)
- 인증: bcrypt + jsonwebtoken (JWT)
- 데이터베이스: Supabase PostgreSQL (pg로 직접 연결, Supabase SDK 미사용)

## 핵심 아키텍처

```
브라우저 (index.html)
    ↓ fetch + Authorization: Bearer {JWT}
Express 서버 (server.js)
    ↓ authenticateToken 미들웨어 → req.user.userId
    ↓ PostgreSQL Pool (Parameterized Query)
Supabase PostgreSQL (users, todos 테이블)
```

### 인증 흐름

```
회원가입/로그인 → JWT 토큰 발급 → localStorage에 저장
    → 모든 API 호출에 Bearer 토큰 첨부 (authFetch 헬퍼)
    → 서버에서 authenticateToken으로 검증 → req.user.userId로 데이터 필터링
```

### 프론트엔드 컴포넌트 구조

모든 컴포넌트가 `index.html` 단일 파일 내 `<script type="text/babel">` 블록에 정의되어 있습니다.

```
App (최상위 - 인증 상태에 따라 화면 전환)
├── LoginForm (로그인 화면)
├── RegisterForm (회원가입 화면)
└── TodoApp (투두 관리 - user, onLogout props)
```

프론트엔드 헬퍼 함수: `getToken()`, `setToken()`, `removeToken()`, `authFetch()` — 토큰 관리 및 인증된 API 호출을 담당합니다.

## 개발 명령어

### 백엔드 서버 실행

```bash
npm start     # 또는 npm run dev (동일하게 node server.js 실행)
```

### 프론트엔드 실행

Express 서버가 `index.html`을 자동으로 서빙합니다. 서버 실행 후 `http://localhost:3000` 접속.

### 테스트

현재 테스트 스위트 미구성 (`npm test`는 에러 출력만 함). 테스트 추가 시 package.json의 test 스크립트 수정 필요.

## 환경 설정

### 필수 환경변수 (.env)

```env
DATABASE_URL=postgresql://user:password@host:port/database
PORT=3000
JWT_SECRET=랜덤_시크릿_키
```

- `.env` 파일은 Git에 커밋하지 않음 (`.gitignore`에 포함)
- `JWT_SECRET`은 `openssl rand -hex 32`로 생성 가능

## API 엔드포인트

### 인증 API (공개)

- `POST /api/auth/register` — 회원가입 (`{ email, password }`)
- `POST /api/auth/login` — 로그인 (`{ email, password }`)
- `GET /api/auth/me` — 현재 사용자 확인 (토큰 필요)

### 투두 API (인증 필요 — authenticateToken 미들웨어)

- `GET /api/todos` — 로그인한 사용자의 할 일 목록 조회
- `POST /api/todos` — 할 일 추가 (`{ text }`)
- `PATCH /api/todos/:id` — 완료 상태 변경 (`{ completed }`)
- `DELETE /api/todos/:id` — 할 일 삭제

모든 투두 쿼리에 `WHERE user_id = $N` 조건 필수 (다른 사용자 데이터 접근 방지).

## 데이터베이스 스키마

### users 테이블

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### todos 테이블

```sql
CREATE TABLE todos (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_todos_user_id ON todos(user_id);
```

서버 시작 시 `initializeDatabase()`가 `CREATE TABLE IF NOT EXISTS`로 자동 생성.

## 데이터베이스 연결

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
```

- Pool로 연결 재사용, SSL 필수 (Supabase 요구사항)
- **반드시 Parameterized Query 사용** (`$1`, `$2` — SQL Injection 방지)
- `RETURNING *`로 변경된 데이터 반환, `result.rows`로 접근

## 코드 수정 시 주의사항

### 백엔드

- **Express 5 문법 주의**: 와일드카드 라우트는 `{*path}` 사용 (Express 4의 `*`와 다름)
- **dotenv 로딩**: `__dirname` 기준 경로 사용 — `path.join(__dirname, '.env')`
- 새 API 엔드포인트: try-catch 에러 처리 + Parameterized Query
- 투두 관련 API: 반드시 `authenticateToken` 미들웨어 적용 + `user_id` 필터
- 비밀번호: bcrypt로 해싱 (SALT_ROUNDS=10), password_hash를 API 응답에 포함 금지
- JWT 토큰: JWT_EXPIRES_IN = '7d' (7일 유효)
- 환경변수 추가 시: `.env` 파일에 추가 + `server.js`에서 검증 로직
- Graceful shutdown 구현됨 (SIGINT/SIGTERM 시 pool.end() 호출)

### 프론트엔드

- API 호출: 인증이 필요한 API는 `authFetch()` 사용 (토큰 자동 첨부)
- 인증 불필요 API (register, login): 일반 `fetch()` 사용
- `API_BASE_URL = '/api'` (상대경로) — 로컬/배포 환경 모두 동일하게 동작
- 오프라인 폴백: `fetchTodos`에 재시도 로직(3회) + localStorage 백업 기능 포함

## API 응답 형식

```json
// 성공
{ "data": { ... } }

// 에러
{ "error": "메시지", "details": "상세 정보" }
```

## PostgreSQL 에러 코드

- `42P01` — 테이블이 존재하지 않음 → 서버 재시작 (자동 생성)
- `23505` — Unique violation → 이미 가입된 이메일 (409 응답)
- `23503` — Foreign key violation
- `42703` — 컬럼이 존재하지 않음

## 배포 (Git → GitHub → AWS Lightsail 자동배포)

### 자동배포 파이프라인

```
git push (main 브랜치)
    ↓ GitHub Actions 트리거
SSH로 Lightsail 인스턴스 접속
    ↓ scripts/deploy.sh 실행
git pull → npm install → PM2 재시작
```

### 관련 파일

- `.github/workflows/deploy.yml` — GitHub Actions 워크플로우
- `scripts/deploy.sh` — Lightsail에서 실행되는 배포 스크립트
- `ecosystem.config.js` — PM2 프로세스 관리 설정 (메모리 제한 300MB, 로그 `./logs/` 디렉토리)

### 필요한 GitHub Secrets

- `LIGHTSAIL_HOST` — Lightsail 인스턴스 공인 IP
- `LIGHTSAIL_SSH_KEY` — SSH 프라이빗 키
- `LIGHTSAIL_USERNAME` — SSH 사용자명 (보통 `ubuntu`)

### 환경변수

Lightsail 인스턴스의 `.env`에 설정: `DATABASE_URL`, `JWT_SECRET` (필수), `PORT` (선택)

## 문제 해결

- **서버 시작 안 됨**: `DATABASE_URL`, `JWT_SECRET` 확인 → `lsof -i :3000`으로 포트 충돌 확인
- **DB 연결 실패**: DATABASE_URL 형식 확인, Supabase 프로젝트 Paused 여부 확인
- **401 에러**: 토큰 만료 또는 미전송 → 재로그인
- **CORS 오류**: 서버 재시작
