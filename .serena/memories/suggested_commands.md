# 개발 명령어

## 필수 개발 명령어

### 개발 서버 실행
```bash
npm run dev
```
- 로컬 개발 서버 실행 (http://localhost:3000)
- Hot Module Replacement 지원

### 빌드 및 테스트
```bash
npm run build
```
- 프로덕션 빌드 생성

```bash
npm run lint
```
- ESLint로 코드 품질 검사

### 번들 분석
```bash
ANALYZE=true npm run build
```
- 번들 크기 분석 도구 실행

### 배포
```bash
npm run vercel:deploy
```
- Vercel 프로덕션 배포

```bash
npm run deploy
```
- 배포 웹훅 호출

### E2E 테스트
```bash
npx playwright test
```
- Playwright E2E 테스트 실행

## Supabase 명령어
```bash
supabase db query "SELECT * FROM table_name"
```
- 데이터베이스 쿼리 실행

## 이미지 최적화 명령어
```bash
npx sharp-cli --input public/images --output public/images --format webp
```
- 이미지 WebP 변환

## Git 워크플로우
- main 브랜치에 push 시 자동 배포
- 변경사항 커밋 후 반드시 빌드 테스트 수행