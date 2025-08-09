# Testing Scripts

프로젝트의 다양한 테스트를 실행하는 스크립트들을 관리합니다.

## 📁 하위 디렉터리

### `e2e/`
End-to-End 테스트 스크립트들
- 전체 사용자 플로우 테스트
- Playwright 기반 브라우저 테스트
- 모바일 디바이스 테스트

### `api/`
API 엔드포인트 테스트 스크립트들
- REST API 동작 확인
- 응답 형식 검증
- 에러 처리 테스트

### `security/`
보안 관련 테스트들
- 인증/권한 테스트
- 입력 검증 테스트
- 파일 업로드 보안 테스트

### `performance/`
성능 테스트 스크립트들
- 로딩 속도 측정
- 메모리 사용량 모니터링
- 파티클 시스템 성능 테스트

## 🚀 실행 방법

```bash
# 전체 테스트 실행
npm run test

# 개별 테스트 스크립트 실행
node scripts/testing/e2e/test-signup-flow.js
```

## 📊 테스트 결과

- 테스트 결과는 `test-results/` 디렉터리에 저장
- 스크린샷은 PNG 형태로 저장
- JSON 리포트는 분석 후 보관