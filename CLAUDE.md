# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

React + Express를 사용한 투두앱으로, **PostgreSQL 직접 연결 + JWT 인증** 방식을 사용합니다.
- 프론트엔드: React 18 (CDN) + Tailwind CSS — 빌드 도구 없음, `index.html` 단일 파일
- 백엔드: Node.js + Express 5 + PostgreSQL (pg 라이브러리)
- 인증: bcrypt (SALT_ROUNDS=10) + jsonwebtoken (JWT, 7일 유효)
- 데이터베이스: Supabase PostgreSQL (pg Pool로 직접 연결, Supabase SDK 미사용)
- 배포: AWS Lightsail + PM2 + GitHub Actions 자동배포

## 핵심 아키텍처

```
브라우저 (index.html)
    ↓ fetch + Authorization: Bearer {JWT}
Express 서버 (server.js)
    ↓ authenticateToken 미들웨어 → req.user.userId
    ↓ PostgreSQL Pool (Parameterized Query, max=10)
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

```bash
npm start     # 서버 실행 (node server.js), http://localhost:3000 접속
npm run dev   # 동일
```

Express 서버가 `index.html`을 자동으로 서빙합니다. 별도 프론트엔드 빌드 없음.

현재 테스트 스위트 미구성 (`npm test`는 에러 출력만 함).

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

### 헬스 체크

- `GET /api/health` — 서버 상태 + DB 연결 확인

### 인증 API (공개)

- `POST /api/auth/register` — 회원가입 (`{ email, password }`)
- `POST /api/auth/login` — 로그인 (`{ email, password }`)
- `GET /api/auth/me` — 현재 사용자 확인 (토큰 필요)

### 투두 API (인증 필요 — authenticateToken 미들웨어)

- `GET /api/todos` — 로그인한 사용자의 할 일 목록 조회
- `POST /api/todos` — 할 일 추가 (`{ text }`, 최대 500자)
- `PATCH /api/todos/:id` — 완료 상태 변경 (`{ completed }`)
- `DELETE /api/todos/:id` — 할 일 삭제

모든 투두 쿼리에 `WHERE user_id = $N` 조건 필수 (다른 사용자 데이터 접근 방지).

### API 응답 형식

```json
// 성공 (모든 엔드포인트 통일)
{ "data": { ... } }

// 에러
{ "error": "메시지" }
```

## 데이터베이스

### 스키마

서버 시작 시 `initializeDatabase()`가 `CREATE TABLE IF NOT EXISTS`로 자동 생성.

- `users`: id(BIGSERIAL), email(UNIQUE), password_hash, created_at
- `todos`: id(BIGSERIAL), text, completed, user_id(FK → users.id ON DELETE CASCADE), created_at
- 인덱스: `idx_todos_user_id`

### 연결 설정

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,                        // 최대 동시 연결 수
  idleTimeoutMillis: 30000,       // 유휴 연결 30초 후 해제
  connectionTimeoutMillis: 5000   // 연결 시도 5초 타임아웃
});
```

- **반드시 Parameterized Query 사용** (`$1`, `$2` — SQL Injection 방지)
- SELECT 쿼리: 필요한 컬럼만 명시 (`SELECT *` 사용 금지)
- INSERT/UPDATE/DELETE: `RETURNING *`로 변경된 데이터 반환

## 코드 수정 시 주의사항

### 백엔드

- **Express 5 문법**: 와일드카드 라우트는 `{*path}` 사용 (Express 4의 `*`와 다름)
- **dotenv 로딩**: `__dirname` 기준 경로 사용 — `path.join(__dirname, '.env')`
- **라우트 순서**: `express.static` → `/api/health` → SPA 폴백 (`{*path}`) 순서 유지 (순서 바뀌면 프론트엔드가 JSON 응답으로 덮임)
- 새 API 엔드포인트: try-catch 에러 처리 + Parameterized Query
- 투두 관련 API: 반드시 `authenticateToken` 미들웨어 적용 + `user_id` 필터
- 비밀번호: bcrypt로 해싱, password_hash를 API 응답에 포함 금지
- 에러 응답: `{ error: "메시지" }` 형식만 사용, `err.message` 등 내부 정보 노출 금지

### 프론트엔드

- API 호출: 인증이 필요한 API는 `authFetch()` 사용 (토큰 자동 첨부)
- 인증 불필요 API (register, login): 일반 `fetch()` 사용
- `API_BASE_URL = '/api'` (상대경로) — 로컬/배포 환경 모두 동일하게 동작
- 오프라인 폴백: `fetchTodos`에 재시도 로직(3회) + localStorage 백업 기능 포함
- 키보드 이벤트: `onKeyDown` 사용 (`onKeyPress`는 deprecated)
- 폼 입력 필드: `autoComplete` 속성 필수 (로그인: `current-password`, 회원가입: `new-password`)
- 투두 입력: `maxLength={500}` 설정 (서버에서도 500자 검증)

## 배포 (Git → GitHub → AWS Lightsail 자동배포)

### 자동배포 파이프라인

```
git push (main 브랜치)
    ↓ GitHub Actions 트리거
SSH로 Lightsail 인스턴스 접속
    ↓ scripts/deploy.sh 실행
git pull → npm install → mkdir -p logs → PM2 재시작
```

### 관련 파일

- `.github/workflows/deploy.yml` — GitHub Actions 워크플로우
- `scripts/deploy.sh` — Lightsail에서 실행되는 배포 스크립트
- `ecosystem.config.js` — PM2 프로세스 관리 설정 (메모리 제한 300MB, 로그 `./logs/`)

### 필요한 GitHub Secrets

- `LIGHTSAIL_HOST` — Lightsail 인스턴스 공인 IP
- `LIGHTSAIL_SSH_KEY` — SSH 프라이빗 키
- `LIGHTSAIL_USERNAME` — SSH 사용자명 (보통 `ubuntu`)

### 배포 환경

Lightsail 인스턴스의 `.env`에 설정: `DATABASE_URL`, `JWT_SECRET` (필수), `PORT` (선택)

## 문제 해결

- **서버 시작 안 됨**: `DATABASE_URL`, `JWT_SECRET` 확인 → `lsof -i :3000`으로 포트 충돌 확인
- **DB 연결 실패**: DATABASE_URL 형식 확인, Supabase 프로젝트 Paused 여부 확인
- **401 에러**: 토큰 만료 또는 미전송 → 재로그인
- **CORS 오류**: 서버 재시작
- **프론트엔드 안 보임 (JSON 표시)**: `express.static`이 API 라우트보다 먼저 오는지 확인
