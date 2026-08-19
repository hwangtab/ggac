module.exports = {
  '*.{js,jsx,ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
  // .mjs/.cjs는 eslint 대상이 아니다(npm run lint는 `src e2e`만 훑는다).
  // 그런데 CI의 `prettier --check .`는 저장소 전체를 보므로, 이 글롭이 없으면
  // scripts/**/*.mjs가 포맷되지 않은 채 커밋돼 CI에서만 실패한다.
  '*.{mjs,cjs}': ['prettier --write'],
  '*.{css,scss}': ['prettier --write'],
}
