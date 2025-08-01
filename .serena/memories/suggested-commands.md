# 개발용 주요 명령어

## 핵심 개발 명령어
- `npm run dev` - 개발 서버 시작 (localhost:3000)
- `npm run build` - 프로덕션 빌드
- `npm run start` - 프로덕션 서버 시작
- `npm run lint` - ESLint 코드 품질 검사

## 테스팅 명령어
프로젝트에는 공식 테스트 프레임워크 대신 수동 테스트 스크립트들이 있습니다:
- `node test-website.js` - 로컬 개발 서버 엔드포인트 테스트
- `node test-board.js` - 게시판 기능 테스트 (Playwright 필요)
- `node test-signup-flow.js` - 멤버 등록 및 인증 플로우 테스트
- `node test-image-loading.js` - 이미지 최적화 및 로딩 테스트
- `node test-mobile-login.js` - 모바일 로그인 플로우 테스트
- `node check-supabase-status.js` - Supabase 연결 및 데이터베이스 상태 확인

## Vercel 명령어
- `npm run vercel:build` - Vercel 배포용 빌드
- `npm run vercel:dev` - Vercel 개발 서버
- `npm run vercel:deploy` - 프로덕션 배포
- `npm run vercel:preview` - 프리뷰 배포

## 번들 분석
- `ANALYZE=true npm run build` - 번들 분석 리포트 생성 (http://localhost:8888에서 확인)

## 배포 및 알림
- `npm run deploy` - 웹훅을 통한 수동 배포 트리거
- `npm run deploy:notify` - Slack으로 배포 알림 전송