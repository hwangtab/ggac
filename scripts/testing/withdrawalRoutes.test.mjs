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

test('탈퇴 확정 뒤 커밋된 결과로 빌링키 해지를 시도한다', async () => {
  const src = await readFile(ADMIN_ROUTE, 'utf8')
  // withdrawMember가 커밋 전에 지운 빌링키를 revokedBillingKeys로 돌려주고,
  // 라우트는 그 목록으로 커밋 뒤에 토스 해지를 부른다.
  assert.match(src, /revokedBillingKeys/)
  assert.match(src, /deleteBillingKey/)
  // 해지는 트랜잭션이 끝난 뒤(withdrawMember 호출 이후)에 있어야 한다 —
  // 트랜잭션 안에서 외부 네트워크를 부르면 쓰기 락을 잡은 채 기다리게 된다.
  const withdrawBlock = src.slice(src.indexOf("action === 'withdraw'"))
  const withdrawMemberAt = withdrawBlock.indexOf('await withdrawMember(')
  const deleteBillingKeyAt = withdrawBlock.indexOf('deleteBillingKey(')
  assert.ok(withdrawMemberAt >= 0 && deleteBillingKeyAt >= 0, '두 호출을 찾지 못했다')
  assert.ok(withdrawMemberAt < deleteBillingKeyAt, '해지는 확정 트랜잭션 뒤에 있어야 한다')
  // 해지 실패가 탈퇴 자체를 무효로 만들면 안 된다.
  assert.match(withdrawBlock, /catch[\s\S]{0,400}(BILLING_KEY_REVOKE_FAILED|해지 실패)/)
})

// ---------------------------------------------------------------- 레이트리밋

test('탈퇴 신청·취소 라우트에 레이트리밋이 걸려 있다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  // POST/DELETE 각각에 걸려야 한다 — 둘 다 상태를 바꾸는 쓰기다.
  assert.match(src, /rateLimit\(request, 'GENERAL_API'\)/)
  const postBody = src.slice(
    src.indexOf('export async function POST'),
    src.indexOf('export async function DELETE')
  )
  const deleteBody = src.slice(src.indexOf('export async function DELETE'))
  assert.match(postBody, /rl\.success/, 'POST에 레이트리밋 검사가 없다')
  assert.match(deleteBody, /rl\.success/, 'DELETE에 레이트리밋 검사가 없다')
})
