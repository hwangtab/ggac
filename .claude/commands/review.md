현재 브랜치의 변경사항(git diff HEAD)을 분석해서 코드 리뷰를 해줘.

다음 관점에서 검토해줘:

### 1. 보안 (Security)

- XSS, SQL Injection, CSRF, SSRF 취약점
- 인증/인가 로직 문제
- 민감 정보 노출 (API 키, 토큰 등)
- CSP 정책 영향

### 2. 성능 (Performance)

- N+1 쿼리 패턴
- 불필요한 리렌더링
- 번들 크기 영향
- 이미지 최적화 누락

### 3. 접근성 (Accessibility)

- ARIA 속성 누락
- 키보드 접근성
- 색상 대비
- 스크린리더 호환성

### 4. 코드 품질 (Code Quality)

- 타입 안전성
- 에러 처리
- 코드 중복
- CLAUDE.md 컨벤션 준수

각 이슈는 **파일명:줄번호** 형식으로 위치를 명시하고, 심각도(HIGH/MEDIUM/LOW)를
표시해줘. 이슈가 없으면 "✅ 이슈 없음"으로 표시해줘.
