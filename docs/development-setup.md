# 개발 환경 설정 가이드

경기아트콜렉티브 웹사이트 개발을 위한 환경 설정 가이드입니다.

## 📋 목차

- [시스템 요구사항](#시스템-요구사항)
- [개발 도구 설치](#개발-도구-설치)
- [프로젝트 설정](#프로젝트-설정)
- [환경 변수 설정](#환경-변수-설정)
- [데이터베이스 설정](#데이터베이스-설정)
- [개발 서버 실행](#개발-서버-실행)
- [VS Code 확장 프로그램](#vs-code-확장-프로그램)
- [트러블슈팅](#트러블슈팅)

---

## 💻 시스템 요구사항

### 최소 요구사항
- **Node.js**: 18.17.0 이상 (LTS 권장)
- **npm**: 9.0.0 이상
- **Git**: 2.30.0 이상
- **메모리**: 8GB RAM (16GB 권장)
- **저장공간**: 10GB 이상 여유 공간

### 권장 환경
- **OS**: macOS 12+, Windows 11, Ubuntu 20.04+
- **브라우저**: Chrome 100+, Firefox 98+, Safari 15+
- **에디터**: VS Code 1.70+ (권장), WebStorm 2022.2+

---

## 🛠️ 개발 도구 설치

### 1. Node.js 설치

**macOS (Homebrew 사용):**
```bash
brew install node@18
brew install npm
```

**Windows (Chocolatey 사용):**
```powershell
choco install nodejs --version=18.17.0
```

**직접 설치:**
[Node.js 공식 웹사이트](https://nodejs.org)에서 LTS 버전 다운로드

### 2. 필수 전역 패키지 설치
```bash
# Next.js CLI
npm install -g create-next-app

# TypeScript 컴파일러
npm install -g typescript

# Vercel CLI (배포용)
npm install -g vercel

# Sharp (이미지 최적화)
npm install -g sharp-cli
```

### 3. Git 설정
```bash
# 사용자 정보 설정
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# 기본 브랜치 설정
git config --global init.defaultBranch main

# 줄바꿈 처리 (Windows)
git config --global core.autocrlf true

# 줄바꿈 처리 (macOS/Linux)
git config --global core.autocrlf input
```

---

## 📁 프로젝트 설정

### 1. 리포지토리 클론
```bash
# SSH (권장)
git clone git@github.com:hwangtab/ggac.git

# HTTPS
git clone https://github.com/hwangtab/ggac.git

cd ggac
```

### 2. 의존성 설치
```bash
# NPM 의존성 설치
npm install

# 개발 의존성 확인
npm audit

# Sharp 네이티브 모듈 설치 (이미지 최적화용)
npm rebuild sharp
```

### 3. 프로젝트 구조 확인
```
ggac/
├── src/
│   ├── app/                 # Next.js App Router
│   ├── components/          # 재사용 가능한 컴포넌트
│   ├── hooks/              # 커스텀 React 훅
│   ├── utils/              # 유틸리티 함수
│   ├── types/              # TypeScript 타입 정의
│   └── constants/          # 상수 정의
├── public/                 # 정적 파일
├── docs/                   # 프로젝트 문서
├── data/                   # JSON 데이터 파일
├── .env.local             # 환경 변수 (로컬)
├── next.config.js         # Next.js 설정
├── tailwind.config.js     # Tailwind CSS 설정
├── tsconfig.json          # TypeScript 설정
└── package.json           # 프로젝트 메타데이터
```

---

## ⚙️ 환경 변수 설정

### 1. 환경 변수 파일 생성
```bash
# .env.local 파일 생성 (Git에서 무시됨)
cp .env.example .env.local
```

### 2. 필수 환경 변수 설정

**`.env.local` 파일 편집:**
```bash
# Supabase 설정
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# 애플리케이션 설정
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000

# 이미지 최적화
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloudinary_name

# 개발 모드 설정
NODE_ENV=development
NEXT_PUBLIC_APP_ENV=development

# 디버깅 (선택사항)
DEBUG=true
NEXT_PUBLIC_DEBUG=true

# Redis (선택사항 - 캐싱용)
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

### 3. 환경 변수 검증
```bash
# 환경 변수 확인
npm run env:check

# 또는 개발 서버 시작 시 자동 검증
npm run dev
```

---

## 🗄️ 데이터베이스 설정

### 1. Supabase 프로젝트 생성
1. [Supabase](https://supabase.com)에 로그인
2. 새 프로젝트 생성
3. 프로젝트 URL과 API 키 복사

### 2. 데이터베이스 스키마 설정
```bash
# Supabase CLI 설치 (선택사항)
npm install -g supabase

# 로컬 Supabase 시작 (선택사항)
supabase start

# 마이그레이션 적용
supabase db push
```

### 3. 초기 데이터 설정
```bash
# 아티스트 데이터 로드
npm run data:seed

# 또는 수동으로 데이터 파일 확인
ls data/
```

---

## 🚀 개발 서버 실행

### 1. 개발 서버 시작
```bash
# 기본 개발 서버 (포트 3000)
npm run dev

# 특정 포트로 시작
PORT=3001 npm run dev

# 디버그 모드로 시작
npm run dev:debug
```

### 2. 빌드 및 테스트
```bash
# 프로덕션 빌드
npm run build

# 빌드된 앱 실행
npm run start

# 린트 검사
npm run lint

# 타입 검사
npm run type-check

# 전체 품질 검사
npm run check
```

### 3. 개발 도구 실행
```bash
# 번들 분석기
ANALYZE=true npm run build

# Playwright E2E 테스트
npx playwright test

# 스토리북 (컴포넌트 문서)
npm run storybook
```

---

## 🔧 VS Code 확장 프로그램

### 필수 확장 프로그램
```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "ms-playwright.playwright",
    "unifiedjs.vscode-mdx",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "ms-vscode.vscode-json",
    "redhat.vscode-yaml"
  ]
}
```

### VS Code 설정
**`.vscode/settings.json`:**
```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "tailwindCSS.experimental.classRegex": [
    ["clsx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ],
  "files.exclude": {
    "**/.next": true,
    "**/node_modules": true,
    "**/.git": true
  }
}
```

---

## 📱 브라우저 개발 도구

### Chrome DevTools 확장
- **React Developer Tools**
- **Redux DevTools** (상태 관리 디버깅)
- **Lighthouse** (성능 분석)

### 모바일 테스트
```bash
# iOS Safari 디버깅
npm run dev -- --hostname 0.0.0.0

# 또는 ngrok 사용
npx ngrok http 3000
```

---

## 🔧 트러블슈팅

### 일반적인 문제들

**1. Node.js 버전 문제**
```bash
# 현재 버전 확인
node --version

# nvm으로 버전 관리 (권장)
nvm install 18
nvm use 18
```

**2. 의존성 충돌**
```bash
# 노드 모듈 재설치
rm -rf node_modules package-lock.json
npm install

# 캐시 클리어
npm cache clean --force
```

**3. Sharp 모듈 오류**
```bash
# Sharp 재설치
npm uninstall sharp
npm install sharp

# 네이티브 의존성 리빌드
npm rebuild sharp
```

**4. 포트 충돌**
```bash
# 포트 사용 프로세스 확인
lsof -i :3000

# 프로세스 종료
kill -9 <PID>
```

**5. 타입스크립트 오류**
```bash
# 타입스크립트 서버 재시작
# VS Code: Cmd/Ctrl + Shift + P → "TypeScript: Restart TS Server"

# 타입 정의 재설치
rm -rf node_modules/@types
npm install
```

**6. 환경 변수 문제**
```bash
# 환경 변수 로드 확인
npm run env:check

# .env.local 파일 권한 확인
chmod 600 .env.local
```

### 성능 최적화

**1. 개발 서버 속도 향상**
```javascript
// next.config.js
module.exports = {
  // 빠른 새로고침
  experimental: {
    optimizeCss: true
  },
  // 웹팩 캐시 활용
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = {
        type: 'filesystem'
      }
    }
    return config
  }
}
```

**2. TypeScript 성능 향상**
```json
// tsconfig.json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo"
  },
  "ts-node": {
    "swc": true
  }
}
```

### 도움이 되는 명령어들

```bash
# 패키지 버전 확인
npm outdated

# 보안 취약점 검사
npm audit

# 번들 크기 분석
npm run analyze

# 디스크 사용량 확인
npx disk-usage

# 프로젝트 헬스 체크
npm run health-check
```

---

## 📞 도움말

### 공식 문서
- [Next.js 문서](https://nextjs.org/docs)
- [React 문서](https://react.dev)
- [TypeScript 문서](https://www.typescriptlang.org/docs)
- [Tailwind CSS 문서](https://tailwindcss.com/docs)
- [Supabase 문서](https://supabase.com/docs)

### 커뮤니티 리소스
- [Next.js GitHub](https://github.com/vercel/next.js)
- [React Discord](https://discord.gg/react)
- [TypeScript Discord](https://discord.gg/typescript)

### 프로젝트별 문의
- GitHub Issues: 버그 리포트 및 기능 요청
- 개발팀 Slack: 실시간 질문 및 토론

---

*이 가이드는 지속적으로 업데이트되며, 새로운 도구나 설정이 추가되면 함께 문서화됩니다.*