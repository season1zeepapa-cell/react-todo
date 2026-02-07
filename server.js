// ========== 1단계: 필요한 모듈 불러오기 ==========

// path: 파일 경로를 안전하게 다루는 Node.js 내장 모듈
const path = require('path');

// dotenv: .env 파일의 환경변수를 읽어옵니다
// __dirname을 사용하여 .env 파일의 정확한 위치를 지정합니다
// (서버 파일과 같은 디렉토리에서 .env를 찾습니다)
require('dotenv').config({ path: path.join(__dirname, '.env') });

// express: 웹 서버를 쉽게 만들어주는 프레임워크
const express = require('express');

// cors: 브라우저와 서버 간 통신을 허용 (CORS 문제 해결)
const cors = require('cors');

// pg: PostgreSQL 클라이언트 라이브러리
// Pool: 여러 데이터베이스 연결을 효율적으로 관리하는 객체
const { Pool } = require('pg');

// bcrypt: 비밀번호를 안전하게 해싱하는 라이브러리
// 비밀번호를 그대로 저장하면 위험하므로, 암호화된 형태로 저장합니다
const bcrypt = require('bcrypt');

// jsonwebtoken: JWT 토큰을 생성하고 검증하는 라이브러리
// 로그인한 사용자를 식별하기 위한 "출입증" 같은 역할을 합니다
const jwt = require('jsonwebtoken');

// ========== 2단계: 환경변수 확인 ==========

// DATABASE_URL이 없으면 서버를 시작할 수 없습니다
if (!process.env.DATABASE_URL) {
  console.error('❌ 오류: .env 파일에 DATABASE_URL을 설정해주세요!');
  console.error('예시: DATABASE_URL=postgresql://user:password@host:port/database');
  process.exit(1);
}

// JWT_SECRET이 없으면 로그인 기능이 작동하지 않습니다
if (!process.env.JWT_SECRET) {
  console.error('❌ 오류: .env 파일에 JWT_SECRET을 설정해주세요!');
  console.error('예시: JWT_SECRET=your_random_secret_key_here');
  process.exit(1);
}

// JWT 설정 상수
const JWT_SECRET = process.env.JWT_SECRET;  // 토큰 서명에 사용할 비밀키
const JWT_EXPIRES_IN = '7d';                // 토큰 유효기간: 7일
const SALT_ROUNDS = 10;                     // bcrypt 해싱 강도 (높을수록 안전하지만 느림)

// ========== 3단계: PostgreSQL 연결 풀 생성 ==========

// PostgreSQL 연결 풀 생성
// Pool: 데이터베이스 연결을 미리 여러 개 만들어두고 재사용하는 방식
// 매번 새로운 연결을 만드는 것보다 훨씬 효율적입니다
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Supabase는 SSL 연결이 필요하지만 자체 서명 인증서 허용
  }
});

// 연결 성공 시 로그 출력
pool.on('connect', () => {
  console.log('✅ PostgreSQL 데이터베이스에 연결되었습니다!');
});

// 연결 오류 시 로그 출력
pool.on('error', (err) => {
  console.error('❌ PostgreSQL 연결 오류:', err);
});

// ========== 4단계: 데이터베이스 테이블 초기화 ==========

// 서버 시작 시 필요한 테이블이 없으면 자동으로 생성합니다
// IF NOT EXISTS: 이미 테이블이 있으면 건너뜁니다
const initializeDatabase = async () => {
  try {
    // users 테이블: 사용자 정보를 저장합니다
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // todos 테이블: 할 일 목록을 저장합니다
    // user_id: 어떤 사용자의 할 일인지 식별하는 외래키
    // ON DELETE CASCADE: 사용자가 삭제되면 해당 사용자의 할 일도 자동 삭제
    await pool.query(`
      CREATE TABLE IF NOT EXISTS todos (
        id BIGSERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // user_id로 검색할 때 속도를 높이기 위한 인덱스
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id)
    `);

    console.log('✅ 데이터베이스 테이블이 준비되었습니다!');
  } catch (err) {
    console.error('❌ 데이터베이스 초기화 오류:', err);
  }
};

// ========== 5단계: Express 앱 설정 ==========

// Express 앱 생성
const app = express();

// 포트 설정 (환경변수에서 가져오거나 기본값 3000)
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
// cors(): 모든 도메인에서 API 호출 허용
app.use(cors());

// express.json(): JSON 형식의 요청 본문을 자동으로 파싱
app.use(express.json());

// ========== 6단계: 인증 미들웨어 ==========

// JWT 토큰을 검증하는 미들웨어
// "출입증"을 확인하는 것처럼, 요청마다 로그인 여부를 확인합니다
//
// 동작 흐름:
// 1. 요청 헤더에서 토큰 추출
// 2. 토큰이 유효한지 검증
// 3. 유효하면 req.user에 사용자 정보 저장 → 다음 단계로 진행
// 4. 유효하지 않으면 에러 반환
const authenticateToken = (req, res, next) => {
  // Authorization 헤더에서 토큰 추출
  // 형식: "Bearer eyJhbGciOiJIUzI1NiIs..."
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer " 뒤의 토큰만 추출

  // 토큰이 없으면 → 로그인하지 않은 상태
  if (!token) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    // JWT 토큰 검증: 비밀키로 서명을 확인하고, 토큰 안의 정보를 꺼냅니다
    const decoded = jwt.verify(token, JWT_SECRET);
    // req.user에 사용자 정보 저장 (이후 API에서 req.user.userId로 접근 가능)
    req.user = decoded;
    next(); // 다음 미들웨어 또는 API 핸들러로 진행
  } catch (err) {
    // 토큰이 만료되었거나 위조된 경우
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '로그인이 만료되었습니다. 다시 로그인해주세요.' });
    }
    return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
  }
};

// ========== 7단계: 인증 API 엔드포인트 ==========

// [POST] /api/auth/register - 회원가입
// 요청 본문: { "email": "user@example.com", "password": "비밀번호" }
//
// 동작 흐름:
// 1. 이메일, 비밀번호 입력값 검증
// 2. 비밀번호를 bcrypt로 해싱 (암호화)
// 3. users 테이블에 새 사용자 저장
// 4. JWT 토큰 발급 → 응답
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 입력값 검증: 이메일과 비밀번호가 비어있는지 확인
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    // 이메일 형식 검증 (간단한 정규식)
    // @ 앞뒤로 문자가 있고, 점(.)이 포함되어야 합니다
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: '올바른 이메일 형식을 입력해주세요.' });
    }

    // 비밀번호 길이 검증
    if (password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    // 비밀번호 해싱: 원래 비밀번호를 알 수 없는 형태로 변환
    // SALT_ROUNDS: 해싱을 몇 번 반복할지 (높을수록 안전하지만 느림)
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // 사용자 생성 (Parameterized Query로 SQL Injection 방지)
    // email을 소문자로 변환: "User@Email.com" → "user@email.com"
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email.toLowerCase().trim(), passwordHash]
    );

    const user = result.rows[0];

    // JWT 토큰 생성: 사용자 ID와 이메일을 토큰에 담습니다
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // 성공 응답 (비밀번호 해시는 절대 응답에 포함하지 않습니다!)
    res.json({
      data: {
        user: { id: user.id, email: user.email, created_at: user.created_at },
        token
      }
    });
  } catch (err) {
    console.error('회원가입 오류:', err);

    // PostgreSQL 23505: 이미 존재하는 이메일 (UNIQUE 제약 위반)
    if (err.code === '23505') {
      return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
    }

    res.status(500).json({
      error: '서버 오류가 발생했습니다.',
      details: err.message
    });
  }
});

// [POST] /api/auth/login - 로그인
// 요청 본문: { "email": "user@example.com", "password": "비밀번호" }
//
// 동작 흐름:
// 1. 이메일로 사용자 조회
// 2. bcrypt.compare로 비밀번호 검증
// 3. JWT 토큰 발급 → 응답
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 입력값 검증
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    // 이메일로 사용자 조회 (Parameterized Query)
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    // 사용자가 존재하지 않는 경우
    if (result.rows.length === 0) {
      // 보안: "이메일이 없다"고 구체적으로 알려주면 해커가 악용할 수 있으므로
      // "이메일 또는 비밀번호" 통일 메시지를 사용합니다
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = result.rows[0];

    // 비밀번호 검증: 입력한 비밀번호와 저장된 해시를 비교
    // bcrypt.compare: 원래 비밀번호를 해싱한 결과가 저장된 해시와 같은지 확인
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    // JWT 토큰 생성
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // 성공 응답
    res.json({
      data: {
        user: { id: user.id, email: user.email, created_at: user.created_at },
        token
      }
    });
  } catch (err) {
    console.error('로그인 오류:', err);
    res.status(500).json({
      error: '서버 오류가 발생했습니다.',
      details: err.message
    });
  }
});

// [GET] /api/auth/me - 현재 로그인한 사용자 정보 조회
// 페이지를 새로고침했을 때 저장된 토큰이 유효한지 확인하는 용도입니다
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    res.json({ data: { user: result.rows[0] } });
  } catch (err) {
    console.error('사용자 정보 조회 오류:', err);
    res.status(500).json({
      error: '서버 오류가 발생했습니다.',
      details: err.message
    });
  }
});

// ========== 8단계: 투두 API 엔드포인트 (인증 필요) ==========

// [GET] /api/todos - 로그인한 사용자의 할 일 목록 가져오기
// authenticateToken 미들웨어가 먼저 실행되어 로그인 여부를 확인합니다
app.get('/api/todos', authenticateToken, async (req, res) => {
  try {
    // WHERE user_id = $1: 현재 로그인한 사용자의 투두만 조회
    const result = await pool.query(
      'SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );

    const data = result.rows;
    res.json({ data });
  } catch (err) {
    console.error('데이터 로드 오류:', err);

    if (err.code === '42P01') {
      return res.status(500).json({
        error: 'todos 테이블이 존재하지 않습니다. 데이터베이스를 확인해주세요.'
      });
    }

    res.status(500).json({
      error: '서버 오류가 발생했습니다.',
      details: err.message
    });
  }
});

// [POST] /api/todos - 새로운 할 일 추가 (현재 로그인한 사용자에게 귀속)
app.post('/api/todos', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: '할 일 내용을 입력해주세요.' });
    }

    // user_id를 포함하여 INSERT → 이 할 일이 누구의 것인지 기록
    const result = await pool.query(
      'INSERT INTO todos (text, completed, user_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [text, false, req.user.userId]
    );

    const data = result.rows[0];
    res.json({ data });
  } catch (err) {
    console.error('할 일 추가 오류:', err);
    res.status(500).json({
      error: '서버 오류가 발생했습니다.',
      details: err.message
    });
  }
});

// [PATCH] /api/todos/:id - 할 일 완료 상태 변경 (본인의 투두만)
app.patch('/api/todos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { completed } = req.body;

    if (typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'completed는 true 또는 false여야 합니다.' });
    }

    // WHERE id = $2 AND user_id = $3: 본인의 투두만 수정 가능 (다른 사용자 투두 보호)
    const result = await pool.query(
      'UPDATE todos SET completed = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [completed, id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '해당 할 일을 찾을 수 없습니다.' });
    }

    const data = result.rows[0];
    res.json({ data });
  } catch (err) {
    console.error('업데이트 오류:', err);
    res.status(500).json({
      error: '서버 오류가 발생했습니다.',
      details: err.message
    });
  }
});

// [DELETE] /api/todos/:id - 할 일 삭제 (본인의 투두만)
app.delete('/api/todos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // WHERE id = $1 AND user_id = $2: 본인의 투두만 삭제 가능
    const result = await pool.query(
      'DELETE FROM todos WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: '해당 할 일을 찾을 수 없습니다.' });
    }

    res.json({ message: '할 일이 삭제되었습니다.' });
  } catch (err) {
    console.error('삭제 오류:', err);
    res.status(500).json({
      error: '서버 오류가 발생했습니다.',
      details: err.message
    });
  }
});

// [GET] / - 서버 상태 확인 (헬스 체크)
app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      message: '✅ 투두앱 백엔드 서버가 정상 작동 중입니다!',
      database: 'PostgreSQL 연결 정상',
      endpoints: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        getTodos: 'GET /api/todos',
        createTodo: 'POST /api/todos',
        updateTodo: 'PATCH /api/todos/:id',
        deleteTodo: 'DELETE /api/todos/:id'
      }
    });
  } catch (err) {
    res.status(500).json({
      message: '⚠️ 서버는 작동 중이지만 데이터베이스 연결에 문제가 있습니다.',
      error: err.message
    });
  }
});

// ========== 9단계: 프론트엔드 정적 파일 서빙 ==========

// express.static: 프로젝트 루트 폴더의 정적 파일(index.html, CSS, JS 등)을 서빙
// __dirname은 현재 파일(server.js)이 있는 프로젝트 루트를 가리킵니다
app.use(express.static(__dirname));

// SPA 폴백: API가 아닌 모든 요청은 index.html로 보냅니다
// 예: /login, /register 같은 경로로 접속해도 index.html이 응답합니다
// Express 5에서는 와일드카드를 '{*path}' 형식으로 작성해야 합니다
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== 10단계: 서버 시작 ==========

// 데이터베이스 테이블 초기화 후 서버 시작
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log(`✅ 서버가 http://localhost:${PORT} 에서 실행 중입니다!`);
    console.log('='.repeat(50));
    console.log('📌 인증 API:');
    console.log(`   POST   http://localhost:${PORT}/api/auth/register`);
    console.log(`   POST   http://localhost:${PORT}/api/auth/login`);
    console.log(`   GET    http://localhost:${PORT}/api/auth/me`);
    console.log('📌 투두 API (로그인 필요):');
    console.log(`   GET    http://localhost:${PORT}/api/todos`);
    console.log(`   POST   http://localhost:${PORT}/api/todos`);
    console.log(`   PATCH  http://localhost:${PORT}/api/todos/:id`);
    console.log(`   DELETE http://localhost:${PORT}/api/todos/:id`);
    console.log('='.repeat(50));
    console.log('💡 팁: Ctrl+C를 눌러서 서버를 종료할 수 있습니다.');
    console.log('='.repeat(50));
  });
});

// ========== 11단계: Graceful Shutdown (안전한 서버 종료) ==========

// SIGINT: Ctrl+C를 눌렀을 때 발생하는 시그널
// SIGTERM: 시스템이 프로세스를 종료할 때 발생하는 시그널
const shutdown = async (signal) => {
  console.log(`\n${signal} 시그널을 받았습니다. 서버를 안전하게 종료합니다...`);

  try {
    await pool.end();
    console.log('✅ PostgreSQL 연결이 종료되었습니다.');
  } catch (err) {
    console.error('❌ 연결 종료 오류:', err);
  }

  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
