/**
 * 관리자 화면이 탈퇴 회원을 제대로 다루는지 못박는다.
 *
 * 2026-09-02 감사 — 탈퇴 기능을 배포했는데 관리자 목록의 타입 유니온과 배지
 * 함수가 `'withdrawn'`을 몰라서, 탈퇴 회원이 **"알 수 없음"** 회색 배지로 떴다.
 * 상태 필터 드롭다운에도 탈퇴 옵션이 없어 골라볼 방법이 없었다.
 *
 * `MemberDetailModal`은 처음부터 올바르게 처리하고 있었다 — 같은 회원을 두
 * 화면이 다르게 그리는 상태였다.
 *
 * 정적 검사인 이유: 이 파일들은 `'use client'` React 컴포넌트라 node:test에서
 * 임포트할 수 없다. 문자열 존재만 보므로 **동작을 보장하지는 않는다** — 그래도
 * 타입·배지·필터가 통째로 빠지는 회귀는 잡는다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = rel => readFile(new URL(`../../${rel}`, import.meta.url), 'utf8')

const TYPED_FILES = [
  'src/app/[locale]/admin/members/components/MemberCard.tsx',
  'src/app/[locale]/admin/members/page.tsx',
  'src/app/[locale]/admin/notifications/page.tsx',
]

for (const rel of TYPED_FILES) {
  test(`${rel.split('/').pop()}의 상태 유니온이 'withdrawn'을 안다`, async () => {
    const src = await read(rel)
    const union = src.match(/registration_status: '[^\n]*'/)
    assert.ok(union, '상태 유니온을 찾지 못했다 — 파일 구조가 바뀌었으면 이 목록을 갱신해라')
    assert.match(
      union[0],
      /'withdrawn'/,
      '탈퇴 회원이 타입 밖으로 밀려난다 — 배지·필터가 조용히 default로 떨어진다'
    )
  })
}

test('회원 카드가 탈퇴를 "탈퇴함"으로 그린다', async () => {
  const src = await read('src/app/[locale]/admin/members/components/MemberCard.tsx')
  assert.match(src, /case 'withdrawn':/, "배지 함수가 'withdrawn' 분기를 가져야 한다")
  assert.match(src, /'탈퇴함'/, '"알 수 없음"으로 떨어지면 안 된다')
})

test('회원 카드와 상세 모달이 같은 탈퇴 배지 색을 쓴다', async () => {
  // 두 화면이 같은 회원을 다른 색으로 그리면 관리자가 다른 상태로 읽는다.
  const card = await read('src/app/[locale]/admin/members/components/MemberCard.tsx')
  const modal = await read('src/app/[locale]/admin/members/components/MemberDetailModal.tsx')
  const colorOf = src => {
    const m = src.match(/case 'withdrawn':\s*\n\s*return '([^']+)'/)
    return m?.[1]
  }
  const cardColor = colorOf(card)
  assert.ok(cardColor, '회원 카드에서 탈퇴 배지 색을 찾지 못했다')
  assert.equal(cardColor, colorOf(modal), '두 화면의 탈퇴 배지 색이 다르다')
})

test('상태 필터로 탈퇴 회원을 골라볼 수 있다', async () => {
  const src = await read('src/app/[locale]/admin/members/page.tsx')
  assert.match(
    src,
    /<option value="withdrawn">/,
    '필터에 탈퇴 옵션이 없으면 관리자가 목록에서 골라볼 방법이 없다'
  )
})
