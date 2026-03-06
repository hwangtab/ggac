다음 검증을 순서대로 실행하고 결과를 요약해줘:

1. `npm run lint:fix` — ESLint 자동 수정
2. `npm run format` — Prettier 포맷팅
3. `npm run type-check` — TypeScript 타입 검사
4. `npm run build` — 프로덕션 빌드

각 단계에서 오류가 발생하면 즉시 멈추고 원인과 해결 방법을 설명해줘. 모든 단계가
통과되면 "✅ 모든 검증 통과" 메시지를 출력해줘.
