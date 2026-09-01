import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const ROUTE = new URL('../../src/app/api/mypage/withdrawal/route.ts', import.meta.url)

test('탈퇴 신청·취소는 활성 조합원만 부를 수 있다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  assert.match(src, /requireActiveMember/, '인증 게이트가 없다')
  // 인가 판정 결과를 그대로 반환해야 한다 — 무시하면 게이트가 장식이 된다.
  assert.match(src, /instanceof NextResponse/)
})

test('신청 실패는 409다 (조건부 UPDATE의 rowsAffected 판정)', async () => {
  const src = await readFile(ROUTE, 'utf8')
  assert.match(src, /409|conflict/i)
})
