import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PII_NULL_FIELDS } from '../../src/db/queries/withdrawal.ts'
import { WITHDRAWN_PII_COLUMNS } from '../turso/check-invariants.mjs'

/**
 * 탈퇴 확정 때 지워야 할 개인정보 컬럼 목록은 두 곳에 있다 — 정본
 * `PII_NULL_FIELDS`(`src/db/queries/withdrawal.ts`, camelCase)와 그 사본
 * `WITHDRAWN_PII_COLUMNS`(`scripts/turso/check-invariants.mjs`, snake_case).
 * 후자는 `.mjs`라 전자를 임포트하지 못해(플래그 없이 도는 GitHub Actions
 * 백업 워크플로) 손으로 옮겨 적었다 — 그래서 둘이 같은 컬럼 집합을
 * 가리키는지 여기서 못박는다. 한쪽만 고치면 이 테스트가 실패한다.
 */

function camelToSnake(name) {
  return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

test('PII_NULL_FIELDS와 WITHDRAWN_PII_COLUMNS는 같은 컬럼 집합을 가리킨다', () => {
  const canonical = Object.keys(PII_NULL_FIELDS).map(camelToSnake).sort()
  const mirrored = [...WITHDRAWN_PII_COLUMNS].sort()
  assert.deepEqual(
    mirrored,
    canonical,
    '컬럼을 추가·삭제했으면 scripts/turso/check-invariants.mjs의 WITHDRAWN_PII_COLUMNS도 고쳐라'
  )
})
