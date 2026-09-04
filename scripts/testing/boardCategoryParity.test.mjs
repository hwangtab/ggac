import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BOARD_CATEGORIES } from '../../src/constants/categories.ts'
import { BOARD_CATEGORY_VALUES } from '../turso/check-invariants.mjs'

/**
 * 게시판 카테고리 목록도 두 곳에 있다 — 정본 `BOARD_CATEGORIES`
 * (`src/constants/categories.ts`)와 그 사본 `BOARD_CATEGORY_VALUES`
 * (`scripts/turso/check-invariants.mjs`). 후자는 `.mjs`라 전자를 임포트하지
 * 못해 손으로 옮겨 적었다(`PII_NULL_FIELDS` 사본과 같은 사정).
 *
 * 이 테스트가 없어서 실제로 어긋났다: '지원사업'을 정본에 더한 뒤 사본을
 * 고치지 않아, 야간 불변식 검사가 정상 글 하나를 위반으로 세며 계속 빨간불을
 * 냈다(2026-09-04 운영 실측). 그런 상태가 이어지면 **진짜 위반이 섞여 들어와도
 * 아무도 알아채지 못한다** — 이미 빨간불이기 때문이다.
 *
 * 정본의 첫 항목 '전체'는 저장되는 값이 아니라 목록 화면의 필터라 사본에서 뺀다.
 */
test('BOARD_CATEGORIES와 BOARD_CATEGORY_VALUES는 같은 카테고리 집합을 가리킨다', () => {
  const canonical = BOARD_CATEGORIES.filter(category => category !== '전체')
  assert.deepEqual(
    [...BOARD_CATEGORY_VALUES].sort(),
    [...canonical].sort(),
    '카테고리를 추가·삭제했으면 scripts/turso/check-invariants.mjs의 BOARD_CATEGORY_VALUES도 고쳐라'
  )
})

test("'전체'는 저장되는 카테고리가 아니다", () => {
  // 사본에 '전체'가 섞이면 필터값으로 저장된 잘못된 행을 불변식이 통과시킨다.
  assert.ok(!BOARD_CATEGORY_VALUES.includes('전체'))
})
