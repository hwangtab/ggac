import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { TIMEBANK_TERMS, getTimebankTerms } from '../../src/constants/timebankTerms.ts'
import { parseTermsText } from '../../src/components/timebank/termsFormat.ts'

/**
 * 이용규칙 전문과 그 렌더 구조(계획 Task 11). 동의 화면은 이 본문을 텍스트
 * 노드로만 그린다 — HTML을 해석하지 않는다.
 */

test('기본 설정의 현재 판(terms_version)에 해당하는 본문이 있다', () => {
  const settingsSource = readFileSync(
    new URL('../../src/lib/timebank/settings.ts', import.meta.url),
    'utf8'
  )
  const match = settingsSource.match(/terms_version:\s*'([^']+)'/)
  assert.ok(match, 'TIMEBANK_DEFAULTS.terms_version을 찾지 못했다')
  assert.equal(typeof getTimebankTerms(match[1]), 'string')
})

test('없는 판·프로토타입 키는 null', () => {
  assert.equal(getTimebankTerms('1999-01'), null)
  assert.equal(getTimebankTerms('toString'), null)
})

test('2026-11 본문은 제1조로 시작해 부칙(판 표시)으로 끝난다', () => {
  const body = TIMEBANK_TERMS['2026-11']
  assert.ok(body.startsWith('**제1조(목적)**'))
  assert.ok(body.endsWith('(판: 2026-11)'))
  for (let n = 1; n <= 21; n++) assert.ok(body.includes(`**제${n}조(`), `제${n}조가 없다`)
  assert.ok(!body.includes('**제22조('), '제21조 뒤에 조항이 더 있다')
  // 조문 머리는 제1조…제21조가 차례대로 한 번씩, 그 뒤에 부칙 하나다.
  const heads = [...body.matchAll(/^\*\*(제\d+조|부칙)/gm)].map(m => m[1])
  assert.deepEqual(heads, [...Array.from({ length: 21 }, (_, i) => `제${i + 1}조`), '부칙'])
})

test('2026-11 본문에는 조율자·조합 업무·시범 운영 조항이 없다 (2026-11-03 이사회 결정)', () => {
  const body = TIMEBANK_TERMS['2026-11']
  for (const word of ['조율자', '조합 업무', '시범']) {
    assert.ok(!body.includes(word), `"${word}"가 남아 있다`)
  }
})

test('문단·항·호를 나누고, 줄바꿈으로 끊긴 문장은 이어 붙인다', () => {
  const blocks = parseTermsText(
    '**제1조(목적)** 첫 줄\n이어지는 줄\n\n**제2조(정의)**\n1. 하나\n2. 둘\n① 항\n   1. 들여쓴 호\n      이어짐\n※ 주석'
  )
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0], [
    {
      indent: false,
      segments: [
        { text: '제1조(목적)', bold: true },
        { text: ' 첫 줄 이어지는 줄', bold: false },
      ],
    },
  ])
  const texts = blocks[1].map(line => line.segments.map(s => s.text).join(''))
  assert.deepEqual(texts, [
    '제2조(정의)',
    '1. 하나',
    '2. 둘',
    '① 항',
    '1. 들여쓴 호 이어짐',
    '※ 주석',
  ])
  assert.deepEqual(
    blocks[1].map(line => line.indent),
    [false, false, false, false, true, false]
  )
})

test('HTML 같은 글자는 해석하지 않고 그대로 텍스트 조각으로 남긴다', () => {
  const [[line]] = parseTermsText('<script>alert(1)</script> **<b>굵게</b>**')
  assert.deepEqual(line.segments, [
    { text: '<script>alert(1)</script> ', bold: false },
    { text: '<b>굵게</b>', bold: true },
  ])
})
