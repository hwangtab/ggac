# 유지보수 및 운영 매뉴얼

경기아트콜렉티브 웹사이트를 다른 개발자도 안정적으로 유지·보수·운영할 수 있도록
정리한 문서입니다. 각 단계에서 필요한 도구와 명령어, 참고 문서를 한 곳에 모아
실제 운영 환경에서 바로 활용할 수 있도록 구성했습니다. 프로젝트의 핵심
아키텍처와 배포 파이프라인, 데이터베이스 관리 방법 등을 빠르게 파악할 수
있습니다.

## 📋 목차

- [개요](#개요)
- [개발 환경 준비](#개발-환경-준비)
- [로컬 개발 및 빌드](#로컬-개발-및-빌드)
- [코드 스타일과 커밋 규칙](#코드-스타일과-커밋-규칙)
- [테스트와 품질 관리](#테스트와-품질-관리)
- [데이터베이스 운영](#데이터베이스-운영)
- [배포와 운영](#배포와-운영)
- [모니터링과 로그](#모니터링과-로그)
- [정기 점검 항목](#정기-점검-항목)
- [트러블슈팅](#트러블슈팅)
- [참고 문서](#참고-문서)

---

## 개요

- **프로젝트**: Next.js + Supabase 기반 웹사이트
- **주요 기술**: React, TypeScript, Tailwind CSS, Vercel
- **데이터/스토리지**: Supabase PostgreSQL + Storage
- **CI/CD**: GitHub → Vercel 자동 배포
- **리포지토리**: `hwangtab/ggac`
- **주요 페이지**: `Home`, `Archive`, `Artists`, `About`, `Connect`
- **모듈 구조**: `src/app`(App Router), `src/components`, `data/`, `supabase/`

---

## 개발 환경 준비

자세한 설정 방법은 [개발 환경 설정 가이드](./development-setup.md)를 참고하세요.
아래는 필수 의존성과 기본 절차입니다.

1. 리포지토리 클론
   ```bash
   git clone git@github.com:hwangtab/ggac.git
   cd ggac
   ```
2. 의존성 설치
   ```bash
   npm install
   ```
3. 전역 도구 설치 (선택)
   ```bash
   npm install -g vercel typescript create-next-app sharp-cli
   ```
4. 환경 변수 파일 생성
   ```bash
   cp .env.example .env.local
   ```
5. Supabase 및 외부 서비스 키를 `.env.local`에 추가

### 필수 환경 변수

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`

자세한 설명은 `.env.example`과
[배포 가이드](./deployment-guide.md#⚙️-환경별-설정)를 참고하세요.

---

## 로컬 개발 및 빌드

| 작업           | 명령어                 | 비고                     |
| -------------- | ---------------------- | ------------------------ |
| 개발 서버 실행 | `npm run dev`          | 기본 포트 `3000`         |
| 프로덕션 빌드  | `npm run build`        | 최적화 및 정적 파일 생성 |
| 빌드 결과 확인 | `npm run start`        | `build` 폴더 사용        |
| 포맷팅         | `npm run format`       | Prettier 자동 정렬       |
| 변경 파일 포맷 | `npm run format:check` | 커밋 전 스타일 확인      |

- 개발 서버는 기본적으로 `http://localhost:3000`에서 실행됩니다.
- 빌드 전에는 반드시 테스트와 린트를 통과해야 합니다.
- Git hooks(Husky)가 설치되어 있으면 커밋·푸시 전에 자동으로 린트/타입 검사가
  수행됩니다.

---

## 코드 스타일과 커밋 규칙

- **코드 포맷**: Prettier 규칙 사용. `.prettierrc.json` 참조.
- **린트**: ESLint (`npm run lint`), 필요한 경우 `npm run lint -- --fix`로 자동
  수정.
- **타입 체크**: TypeScript (`npm run type-check`).
- **커밋 메시지**:
  [Conventional Commits](https://www.conventionalcommits.org/ko/v1.0.0/) 준수.
  - 예시: `feat(auth): add refresh token flow`
  - 타입 규칙은 [`commitlint.config.js`](../commitlint.config.js) 참고.
- **Git Hook**: Husky가 `pre-commit`, `commit-msg`, `pre-push` 스크립트를 실행해
  린트·타입 체크·빌드를 자동으로 검사합니다.
- 커밋 전에 수정 사항을 포맷팅하고 린트를 실행하세요.
  ```bash
  npm run format
  npm run lint
  npm run type-check
  ```

---

## 테스트와 품질 관리

| 항목            | 명령어                   | 비고                                |
| --------------- | ------------------------ | ----------------------------------- |
| 정적 분석       | `npm run lint`           | 코드 스타일과 오류 점검             |
| 타입 검사       | `npm run type-check`     | TypeScript 타입 오류 확인           |
| 유닛 테스트     | `npm test`               | 현재는 스크립트 미구현              |
| E2E 테스트      | `npm run test:e2e`       | Playwright 기반; 브라우저 설치 필요 |
| 포맷 검사       | `npm run format:check`   | Prettier 포맷 일관성 확인           |
| 보안 감사       | `npm run audit:security` | 의존성 취약점 확인                  |
| 의존성 라이센스 | `npm run license:check`  | (스크립트 존재 시) 라이센스 검증    |

테스트는 모든 변경 사항 적용 후에 실행합니다. E2E 테스트 실행 전에는
`npx playwright install`로 브라우저를 설치해야 할 수 있습니다. 보안 감사는
프로덕션 배포 전 반드시 실행해 잠재적인 취약점을 확인하세요.

---

## 데이터베이스 운영

- **플랫폼**: Supabase PostgreSQL
- 마이그레이션 적용: `apply_migration.js` 스크립트 사용
  ```bash
  node apply_migration.js path/to/migration.sql
  ```
  위 스크립트는 SQL을 출력만 하며, 실제 적용은 Supabase Dashboard의 SQL
  Editor에서 수행합니다.
- 성능 검증: `verify_performance.js` 스크립트로 인덱스 및 쿼리 성능을 확인할 수
  있습니다.
  ```bash
  node verify_performance.js
  ```
- 백업: Supabase의 자동 백업 기능을 사용하고, 필요 시 수동 백업을
  다운로드합니다.
- 스테이징 데이터베이스와 프로덕션 데이터베이스를 분리 운영하고, 스키마 변경 시
  반드시 스테이징에서 테스트 후 프로덕션에 반영합니다.
- 대량 데이터 삽입이나 초기화가 필요하면 `supabase/seed` 스크립트를 활용합니다
  (존재할 경우).

---

## 배포와 운영

배포 절차는 [배포 가이드](./deployment-guide.md)에 상세히 설명되어 있습니다.

1. `main` 브랜치에 변경 사항 푸시 → Vercel이 자동으로 프로덕션 배포.
2. 미리보기 배포가 필요한 경우 `npm run deploy:preview` 사용.
3. `npm run deploy`로 수동 배포 가능 (Vercel CLI).
4. 배포 후 `npm run deploy:notify`로 알림 전송 (선택).

### 환경별 변수 관리

- Production: `ggac.kr`, `NEXT_PUBLIC_APP_ENV=production`
- Staging: `staging.ggac.kr`, `NEXT_PUBLIC_APP_ENV=staging`
- Development: 로컬 `.env.local`, `NEXT_PUBLIC_APP_ENV=development`

변경된 환경 변수는 Vercel Dashboard에서 동기화하고, 필요 시 `vercel env pull`로
로컬에 내려받을 수 있습니다.

운영 중에는 Vercel Dashboard에서 빌드 로그와 애플리케이션 상태를 확인합니다.

---

## 모니터링과 로그

- **Vercel Analytics**: 페이지 성능 및 트래픽 확인
- **Supabase 로그**: 데이터베이스 쿼리 및 인증 이벤트 모니터링
- **에러 추적**: Sentry 연동 시 `SENTRY_DSN` 환경 변수 필요
- **캐시/레이트 리밋**: Upstash Redis 사용 시 `UPSTASH_REDIS_REST_URL` 등 설정
- 필요시 추가 모니터링 도구(Logtail, Logflare 등)를 연동할 수 있습니다.

---

## 정기 점검 항목

- 의존성 업데이트 및 보안 취약점 확인 (`npm outdated`, `npm run audit:security`)
- 이미지 및 정적 자산 최적화 (Sharp CLI 활용)
- 데이터베이스 인덱스 및 쿼리 성능 점검 (`node verify_performance.js`)
- 백업 파일 주기적 다운로드 및 보관
- 도메인 만료일 및 SSL 인증서 자동 갱신 여부 확인
- 크론성 작업 또는 예약 함수의 실행 결과 모니터링

---

## 트러블슈팅

| 문제                            | 해결 방법                                                                  |
| ------------------------------- | -------------------------------------------------------------------------- |
| `npm install` 실패              | Node.js 및 npm 버전 확인, `npm cache clean --force` 후 재설치              |
| 개발 서버가 실행되지 않음       | 환경 변수 설정 확인, `npx next info`로 환경 점검, 포트 충돌 여부 확인      |
| 빌드 실패                       | `npm run build` 로그 확인, 타입 오류 및 린트 오류 해결                     |
| 배포 실패                       | Vercel Dashboard의 빌드 로그 확인, 환경 변수 재확인                        |
| 환경 변수 누락                  | `.env.local`과 Vercel 설정 동기화, `vercel env ls`로 변수 목록 확인        |
| Supabase 연결 오류              | 서비스 키 및 URL 확인, Supabase Status 페이지 점검, 네트워크 상태 확인     |
| 브라우저 테스트가 실행되지 않음 | `npx playwright install`로 브라우저 설치, CI 환경에서는 `--with-deps` 사용 |

---

## 참고 문서

- [개발 환경 설정 가이드](./development-setup.md)
- [배포 가이드](./deployment-guide.md)
- [API 엔드포인트 문서](./api-endpoints.md)
- [컴포넌트 API](./components-api.md)
- [마이페이지 시스템 개요](./mypage-system.md)
- [인증 패턴 분석](./authentication-pattern-consistency-analysis.md)
- [코드 개선 계획](./code-improvement-plan.md)
