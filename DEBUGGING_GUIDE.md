# 에러 디버깅 가이드

## 1. 브라우저에서 에러 확인

### Chrome/Edge/Safari 개발자 도구

1. **F12** 또는 **Cmd+Option+I** (Mac)로 개발자 도구 열기
2. **Console 탭**에서 JavaScript 에러 확인
3. **Network 탭**에서 실패한 요청 확인
4. **Application > Storage > Local Storage**에서 캐시 데이터 확인

### 확인할 주요 에러

- `Failed to fetch`
- `500 Internal Server Error`
- `NetworkError`
- `CORS error`

## 2. 서버 에러 로그 확인

### Vercel 대시보드에서 확인

1. https://vercel.com/dashboard 접속
2. ggac 프로젝트 클릭
3. **Functions 탭** → **View Function Logs** 클릭
4. 실시간 로그 확인

### 로컬에서 Vercel CLI 사용

```bash
# Vercel 프로젝트 연결 후
vercel logs

# 특정 함수 로그만 확인
vercel logs --since=1h
```

## 3. 클라이언트 에러 로그 API 확인

우리가 구현한 에러 로깅 시스템 확인:

### 브라우저 콘솔에서 수동 테스트

```javascript
// 콘솔에서 실행
fetch('/api/client-error', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Test error',
    timestamp: new Date().toISOString(),
    url: window.location.href,
  }),
})
```

## 4. 메타데이터 문제 진단

### Open Graph 디버거 사용

1. **Facebook Sharing Debugger**: https://developers.facebook.com/tools/debug/
2. **Twitter Card Validator**: https://cards-dev.twitter.com/validator
3. **LinkedIn Post Inspector**: https://www.linkedin.com/post-inspector/

### 직접 메타데이터 확인

```bash
# 터미널에서 실행
curl -I "https://ggac.kr/archive/satanic-ritual-perversions-vol-ii"

# HTML 헤더 확인
curl -s "https://ggac.kr/archive/satanic-ritual-perversions-vol-ii" | head -50
```

## 5. 캐시 문제 해결

### 브라우저 캐시 완전 삭제

1. **Chrome**: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)
2. **개발자 도구 > Network > Disable cache** 체크
3. **Application > Storage > Clear Storage** 클릭

### CDN/Vercel 캐시 무효화

```bash
# 새 배포로 캐시 무효화
npm run deploy
```

## 6. 문제별 체크리스트

### 썸네일이 안 보이는 경우

- [ ] 이미지 파일이 `/public/images/` 에 존재하는가?
- [ ] 이미지 경로가 올바른가? (대소문자, 확장자)
- [ ] `next.config.js`의 이미지 설정이 올바른가?
- [ ] CDN에서 이미지를 차단하고 있는가?

### 메타데이터가 안 보이는 경우

- [ ] `generateMetadata` 함수가 정상 작동하는가?
- [ ] Open Graph 태그가 올바르게 생성되는가?
- [ ] 페이지가 SSR로 렌더링되는가? (CSR이면 메타데이터 안 보임)
- [ ] 외부 플랫폼 크롤러가 접근 가능한가?

### 500 에러가 계속 나는 경우

- [ ] 환경 변수가 설정되어 있는가?
- [ ] Supabase 연결이 정상인가?
- [ ] 데이터베이스 쿼리가 실패하고 있는가?
- [ ] 빌드 과정에서 에러가 없었는가?

## 7. 실시간 모니터링 설정

### Vercel Analytics 활성화

1. Vercel 대시보드에서 **Analytics** 탭
2. **Enable Analytics** 클릭
3. 실시간 트래픽 및 에러 모니터링

### 에러 알림 설정

프로덕션에서 중요한 에러 발생 시 즉시 알림을 받으려면:

- Sentry 연동
- Discord/Slack 웹훅 설정
- 이메일 알림 설정
