import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 적대 감사(2026-08-27) — 정적 가드가 인가를 강제하지 않는다. 우회 15가지 중
 * **11가지가 초록불**이었다. 문제는 가드의 한계 자체가 아니라(정적 분석의
 * 원리적 한계다) **문서가 그 한계를 말하지 않아 과신을 부른 것**이다.
 * 실제로 컷오버 수행자가 "가드가 인가를 지킨다"고 믿고 보고했다.
 *
 * 이 테스트는 **그 정정이 문서에서 사라지지 않게** 못박는다. 코드가 아니라
 * 문서를 고정하는 것이 이상해 보일 수 있지만, 이 저장소에서 가장 비싼 실패는
 * 전부 "문서가 사실과 달라서 다음 사람이 잘못된 것을 믿은" 형태였다.
 */
const guard = readFileSync('scripts/testing/assert-runtime-risks.mjs', 'utf8')
const claudeMd = readFileSync('CLAUDE.md', 'utf8')
const tursoReadme = readFileSync('scripts/turso/README.md', 'utf8')

test('가드 파일이 자기 한계를 서두에 밝힌다', () => {
  const head = guard.slice(0, 4000)
  assert.match(head, /지키지 않는 것/, '무엇을 못 지키는지 없으면 다음 사람이 과신한다')
  assert.match(head, /도달 가능성·실행 순서·데이터 흐름/, '못 보는 것을 구체적으로 적어야 한다')
  assert.match(head, /test:e2e:authz/, '진짜 안전망이 어디인지 가리켜야 한다')
})

test('CLAUDE.md가 인가 안전망을 E2E로 안내한다', () => {
  assert.match(claudeMd, /권한의 안전망은 E2E다/, '인가를 바꾸는 사람이 가장 먼저 보는 문서다')
  assert.match(claudeMd, /test:e2e:authz/)
})

test('컷오버 절차서에도 같은 정정이 있다', () => {
  assert.match(tursoReadme, /인가는 E2E가 지킨다/)
})

test('세 문서가 같은 기준선(50)을 말한다', () => {
  for (const [name, src] of [
    ['CLAUDE.md', claudeMd],
    ['scripts/turso/README.md', tursoReadme],
  ]) {
    assert.match(src, /50 passed/, `${name}의 기준선이 사라지면 "몇 건이 정상인지"를 잃는다`)
  }
})
