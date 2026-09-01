import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * 이사회 안건 댓글: 작성(POST)에는 레이트리밋이 걸려 있었지만 하위 라우트의
 * 수정(PATCH)·삭제(DELETE)에는 없었다 — 작성만 막고 옆문이 열린 상태였다.
 * 이 파일은 PATCH·DELETE가 POST와 같은 설정·같은 키 생성기를 쓰는지 못박는다.
 */

const POST_ROUTE = new URL(
  '../../src/app/api/board-room/agendas/[id]/comments/route.ts',
  import.meta.url
)
const ITEM_ROUTE = new URL(
  '../../src/app/api/board-room/agendas/[id]/comments/[commentId]/route.ts',
  import.meta.url
)

test('POST 라우트는 POST_CREATION 설정 + board-discussion 키 생성기를 쓴다 (기준선)', async () => {
  const src = await readFile(POST_ROUTE, 'utf8')
  assert.match(src, /RATE_LIMITS\.POST_CREATION/)
  assert.match(src, /createIPKeyGenerator\('board-discussion'\)/)
})

test('PATCH·DELETE 모두 POST와 같은 설정·같은 키 생성기로 레이트리밋을 건다', async () => {
  const src = await readFile(ITEM_ROUTE, 'utf8')

  const patchBody = src.slice(
    src.indexOf('export async function PATCH'),
    src.indexOf('export async function DELETE')
  )
  const deleteBody = src.slice(src.indexOf('export async function DELETE'))

  for (const [name, body] of [
    ['PATCH', patchBody],
    ['DELETE', deleteBody],
  ]) {
    assert.match(body, /RATE_LIMITS\.POST_CREATION/, `${name}에 POST_CREATION 설정이 없다`)
    assert.match(
      body,
      /createIPKeyGenerator\('board-discussion'\)/,
      `${name}이 POST와 다른 키 생성기를 쓴다 — 카운터가 갈린다`
    )
    assert.match(body, /rl\.success/, `${name}에 레이트리밋 검사 결과를 실제로 쓰지 않는다`)
  }
})
