/**
 * 레이트리밋 기본 키가 설정마다 분리되는지 못박는다.
 *
 * 2026-09-01 적대 감사 실측 — 기본 키를 쓰는 라우트 14곳이 `rate_limit:<ip>`
 * 하나를 공유하고 있었다. 창 길이는 60초에서 1시간까지, 상한은 5에서 100까지
 * 제각각인데 카운터가 하나였다.
 *
 * Lua가 `current == 1`일 때만 EXPIRE를 걸기 때문에 **처음 온 요청의 창이 나머지를
 * 전부 지배**하고, 자동 차단은 그때그때 호출된 설정의 `maxRequests * 2`로
 * 판정된다. 그래서 이런 일이 벌어졌다:
 *
 *   게시글 10개 조회(GENERAL_API, 상한 60) → 공유 카운터 10
 *   → 댓글 작성(POST_CREATION, 상한 5 → 자동차단 임계 10)
 *   → 11 > 10 → **IP가 10분간 전면 차단**
 *
 * 평범한 사용 패턴이 사용자를 잠근다. 이 파일은 그 회귀를 잡는다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../../src/utils/distributedRateLimiter.ts', import.meta.url),
  'utf8'
)
const facade = await readFile(new URL('../../src/lib/server/rateLimit.ts', import.meta.url), 'utf8')

test('기본 키에 설정 네임스페이스가 들어간다 (IP 단독이 아니다)', () => {
  assert.match(
    source,
    /return `rate_limit:\$\{namespace\}:\$\{ip\}`/,
    '기본 키는 네임스페이스와 IP를 함께 써야 한다'
  )
  assert.doesNotMatch(
    source,
    /return `rate_limit:\$\{ip\}`/,
    'IP 단독 키로 되돌아가면 모든 설정이 카운터를 공유한다'
  )
})

test('설정 7개 전부 서로 다른 name을 갖는다', () => {
  const block = source.slice(
    source.indexOf('export const DISTRIBUTED_RATE_LIMIT_CONFIGS'),
    source.indexOf('// 키 생성 함수들')
  )
  const names = [...block.matchAll(/name: '([a-z_]+)'/g)].map(m => m[1])

  const configs = [...block.matchAll(/^  ([A-Z_]+): \{/gm)].map(m => m[1])
  assert.equal(
    names.length,
    configs.length,
    `설정 ${configs.length}개 중 ${names.length}개에만 name이 있다 — 빠진 것이 기본 키로 되돌아간다`
  )
  assert.equal(new Set(names).size, names.length, 'name이 겹치면 그 둘은 카운터를 공유한다')
})

test('RouteRateLimitConfig가 name을 통과시킨다', () => {
  // Pick에서 빠지면 라우트를 거쳐 온 설정이 이름을 잃고 조용히 기본 키로 돌아간다.
  const pick = facade.slice(
    facade.indexOf('export type RouteRateLimitConfig'),
    facade.indexOf('export type RateLimitConfig')
  )
  assert.match(pick, /\|\s*'name'/, "Pick에 'name'이 없으면 라우트 경유 시 이름이 사라진다")
})

test('창·상한이 다른 두 설정은 name이 없어도 키가 갈린다 (폴백)', () => {
  assert.match(
    source,
    /const namespace = name \?\? `w\$\{windowMs\}m\$\{maxRequests\}`/,
    'name을 빠뜨린 설정끼리도 값이 다르면 섞이지 않아야 한다'
  )
})
