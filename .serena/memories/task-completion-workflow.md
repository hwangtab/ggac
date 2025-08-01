# 작업 완료 시 필수 체크리스트

## 코드 품질 검사
1. **반드시 ESLint 실행**: `npm run lint` - 에러 없이 통과해야 함
2. **TypeScript 컴파일**: `npm run build` - strict mode 에러 없이 성공해야 함

## 인증 및 기능 테스트
- **인증 플로우**: `node test-signup-flow.js` - 등록/승인/로그인 플로우 확인
- **API 엔드포인트**: `node test-website.js` - 로컬 API 라우트 동작 확인
- **이미지 최적화**: `node test-image-loading.js` - 이미지 로딩 및 최적화 확인

## 성능 관련 변경사항
- **파티클/애니메이션** 변경 시: 다양한 디바이스에서 성능 테스트
- **번들 크기** 확인: `ANALYZE=true npm run build` 실행 후 http://localhost:8888 확인

## 데이터베이스 변경사항
- **스키마 변경**: `supabase/migrations/`에 마이그레이션 파일 버전 관리
- **RLS 정책**: 철저한 테스트 후 배포
- **Supabase 연결**: `node check-supabase-status.js` 확인

## 배포 전 검증
1. **로컬 빌드**: `npm run build` 성공 확인
2. **API 라우트**: 동적 라우트 로컬 테스트
3. **Vercel 배포**: `vercel --prod` 사용
4. **함수 검증**: `vercel inspect [url]` 으로 serverless 함수 생성 확인

## 환경 변수 확인
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`  
- `SUPABASE_SERVICE_ROLE_KEY` (관리자 기능용)