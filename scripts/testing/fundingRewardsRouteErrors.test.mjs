import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * 리워드 일괄 저장 라우트에 오류 처리가 있는지 못박는다.
 *
 * 이 라우트는 `applyRewardBatch`를 부르는데, 그 트랜잭션은 이 앱에서 쓰기
 * 잠금을 가장 오래 쥔다 — 원격 Turso에서 `SQLITE_BUSY`가 실제로 라우트까지
 * 올라온다. 라우트에 `try/catch`가 없으면 Next가 본문 없는 500을 돌려주고,
 * 리워드를 한참 고쳐 넣은 개설자는 아무 문장도 못 받는다.
 *
 * **이 파일이 증명하지 않는 것.** 실제로 그 응답이 나가는지는 보지 않는다 —
 * 문자열이 소스에 있는지만 본다. catch 안에서 조기 반환을 끼우거나 다른 함수로
 * 섀도잉하면 그대로 초록불이다. 동작은 쿼리 계층 테스트
 * (`queriesFunding.test.mjs`의 재시도 배선)와 사람의 손이 본다.
 */

const ROUTE = new URL(
  '../../src/app/api/mypage/funding/campaigns/[id]/rewards/route.ts',
  import.meta.url
)

test('리워드 저장 라우트는 예외를 문장으로 바꿔 돌려준다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  const handler = src.slice(src.indexOf('export async function PUT'))
  const body = handler.slice(0, handler.indexOf('async function handlePut'))

  assert.match(body, /try\s*{/, 'PUT 전체를 감싸는 try가 없다')
  assert.match(body, /catch \(error\)/, 'catch가 없다')
  // 경합과 나머지는 개설자가 할 일이 다르므로 답도 달라야 한다.
  assert.match(body, /isLockContention\(error\)/, '경합을 따로 가려내지 않는다')
  assert.match(body, /ApiError\.serviceUnavailable\(/, '경합에 503을 주지 않는다')
  assert.match(body, /ApiError\.internalServerError\(/, '나머지에 답이 없다')
  // 문장이 "실패했다"로 끝나면 개설자가 할 수 있는 일이 없다. 두 갈래 모두
  // 다음에 무엇을 하라는 말이 들어 있어야 한다.
  assert.match(body, /입력하신 내용은 그대로 남아 있으니[^\n]*다시 저장/)
  assert.match(body, /contact@ggac\.kr/)
})

test('리워드 저장 라우트는 오류 경로에서도 "구매·주문·상품" 어휘를 쓰지 않는다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  for (const banned of ['구매', '주문', '상품', '기부']) {
    assert.ok(!src.includes(banned), `금지 어휘 '${banned}'가 들어 있다`)
  }
})

/**
 * 이 라우트의 쓰기(`applyRewardBatch`)는 사이트 전체의 쓰기 잠금을 잡는다.
 * 빈도 제한이 없으면 초안 프로젝트를 가진 조합원 아무나 이 요청을 되풀이하는
 * 것만으로 결제 확정·선점·환불을 굶길 수 있다(2026-09-25 적대 감사 1번).
 *
 * **이 파일이 증명하지 않는 것**은 위와 같다 — 문자열이 소스에 있는지만 본다.
 * 빈도 제한 자체의 동작은 `rateLimitKeyNamespace.test.mjs`가 본다.
 */
test('리워드 저장 라우트에는 빈도 제한이 걸려 있다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  const handler = src.slice(src.indexOf('async function handlePut'))

  assert.match(handler, /applyRouteRateLimit\(request, \{/, '빈도 제한을 걸지 않는다')
  assert.match(
    handler,
    /name: 'funding_reward_batch'/,
    '설정에 고유한 name이 없으면 카운터를 남과 공유한다'
  )
  assert.match(handler, /keyGenerator: createIPKeyGenerator\(/, '키를 IP로 잡지 않는다')
  assert.match(handler, /rl\.success === false/, 'strict:false라 `!rl.success`는 좁히지 못한다')
  assert.match(handler, /return rl\.response/, '제한에 걸려도 그대로 통과시킨다')

  // 인증(`requireActiveMember`)보다 먼저 돌아야 세션을 만들 필요조차 없이 막힌다.
  assert.ok(
    handler.indexOf('applyRouteRateLimit') < handler.indexOf('requireActiveMember'),
    '빈도 제한이 인증 뒤에 있으면 막히기 전에 세션 조회가 먼저 돈다'
  )
})

test('리워드 저장은 값이 그대로인 리워드를 트랜잭션에 넣지 않는다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  assert.match(src, /rewardPatchChangesNothing\(/, '변경 없는 리워드를 거르지 않는다')
})
