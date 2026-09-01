import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 재리뷰 회귀 방어: `src/app/api/posts/[id]/route.ts`(PATCH)의
 * content_format allowlist에서 'markdown'이 빠져 있으면 지원사업 게시글
 * 편집 저장이 전부 400으로 실패한다.
 *
 * F2가 EditPageClient.tsx에서 편집기가 관리하지 않는 content_format
 * ('markdown')을 보존해 그대로 PATCH 본문에 실어 보내게 고쳤는데, 이 라우트가
 * 'plain'/'html'만 받아 나머지를 null(→ 400 "본문 형식이 올바르지 않습니다")로
 * 막고 있었다 — 저장이 조용히 손상되던 것이 시끄럽게 실패하는 것으로 바뀌었을
 * 뿐, 관리자가 오타 하나 고치는 시나리오는 여전히 안 됐다.
 *
 * 라우트 핸들러 자체는 next/server를 임포트해 이 저장소의 plain node --test
 * 하네스로 직접 부를 수 없다(next 패키지의 subpath export가 Next 번들러
 * 밖에서는 해석되지 않는다 — 실제로 시도해 확인함). 그래서 allowlist 판정을
 * `src/utils/postContentFormat.ts`로 분리해 인증·DB 없이 직접 검증한다.
 */
const { parsePostContentFormat } = await import('../../src/utils/postContentFormat.ts')

test('parsePostContentFormat: markdown을 허용한다 (지원사업 회차 편집 저장이 실패하면 안 된다)', () => {
  assert.equal(parsePostContentFormat('markdown'), 'markdown')
})

test('parsePostContentFormat: 기존에 허용하던 plain/html은 계속 허용한다', () => {
  assert.equal(parsePostContentFormat('plain'), 'plain')
  assert.equal(parsePostContentFormat('html'), 'html')
})

test('회귀 방어: allowlist를 통째로 열지 않았다 — 임의의 값은 여전히 거부된다', () => {
  assert.equal(parsePostContentFormat('javascript'), null)
  assert.equal(parsePostContentFormat('<script>'), null)
  assert.equal(parsePostContentFormat(''), null)
  assert.equal(parsePostContentFormat(undefined), null)
  assert.equal(parsePostContentFormat(null), null)
  assert.equal(parsePostContentFormat(123), null)
  assert.equal(parsePostContentFormat({ toString: () => 'markdown' }), null)
})
