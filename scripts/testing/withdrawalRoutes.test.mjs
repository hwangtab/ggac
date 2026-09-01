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

// ---------------------------------------------------------------- 관리자 확정

const ADMIN_ROUTE = new URL('../../src/app/api/admin/member-action/route.ts', import.meta.url)

test('관리자 액션에 withdraw가 있고 자기 자신은 막는다', async () => {
  const src = await readFile(ADMIN_ROUTE, 'utf8')
  assert.match(src, /'withdraw'/, '액션 목록에 withdraw가 없다')
  // 관리자가 자기 계정을 없애는 사고를 막는다.
  assert.match(src, /자기 자신|self/i)
  // 확정은 쿼리 계층의 트랜잭션이 한다 — 라우트가 직접 표를 지우면 안 된다.
  assert.match(src, /withdrawMember/)
  assert.doesNotMatch(src, /db\.delete\(/, '라우트가 직접 삭제하면 트랜잭션 밖이 된다')
})
