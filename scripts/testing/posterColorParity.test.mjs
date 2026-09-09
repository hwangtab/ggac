/**
 * 포스터(다크) 테마의 색 계열 커버리지 정합성 검사
 *
 * globals.css의 `[data-poster]` 스코프는 밝은 테마 유틸리티를 다크용 값으로
 * 재매핑한다. 그런데 배경·글자·선이 각각 **손으로 적은 계열 목록**이라 서로
 * 어긋날 수 있고, 실제로 어긋났다.
 *
 * 2026-09-09 실측: `text-violet-*`는 밝은 보라(#e9d5ff)로 재매핑돼 있는데
 * `bg-violet-*`는 목록에 없어 밝은 채로 남았다. 정기총회의 '회의록' 배지가
 * 연보라 바탕에 연보라 글씨가 되어 글자가 사라졌다. 알림 화면의
 * `bg-emerald-100 text-emerald-800` 배지도 같은 구멍에 빠져 있었다.
 *
 * 한쪽만 덮이면 반드시 대비가 무너진다.
 * - 글자만 덮이면 → 밝은 바탕 + 밝은 글씨
 * - 배경만 덮이면 → 어두운 바탕 + 어두운 글씨
 *
 * 그래서 이 테스트는 목록을 또 하나 베껴 적지 않는다. globals.css에서 계열을
 * 직접 뽑아 **배경 목록과 글자 목록이 같은 집합인지** 본다. 나아가 소스가
 * 실제로 쓰는 계열이 그 집합 안에 있는지도 확인해, 새 계열을 도입하면서
 * 재매핑을 빠뜨리는 것을 막는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const GLOBALS_CSS = 'src/app/globals.css'
const SRC_DIR = 'src'

/** 밝은 테마 값이 그대로 남으면 다크 위에서 글자를 삼키는 배경 계단 */
const LIGHT_BG_SHADES = new Set(['50', '100', '200'])
/** 다크 면 위에서 읽히지 않는 글자 계단 */
const DARK_TEXT_SHADES = new Set(['600', '700', '800', '900'])

/** 계열 이름만 있고 재매핑이 따로 필요 없는 것들 — 별도 규칙이 담당한다 */
const HANDLED_SEPARATELY = new Set(['gray', 'primary', 'accent', 'white', 'black', 'transparent'])
/** 색 계열처럼 생겼지만 색이 아닌 유틸리티 (`bg-opacity-50` 등) */
const NOT_A_COLOR = new Set(['opacity'])

const css = readFileSync(GLOBALS_CSS, 'utf8')

/**
 * `[data-poster] [class^='bg-violet-']` 같은 셀렉터에서 계열 이름을 모은다.
 * 재매핑의 실제 정의에서 뽑으므로 목록을 베껴 적을 일이 없다.
 */
function familiesOverriddenFor(property) {
  const found = new Set()
  const pattern = new RegExp(
    `\\[data-poster\\]\\s*\\[class(?:\\^|\\*)='\\s?${property}-([a-z]+)-'\\]`,
    'g'
  )
  for (const [, family] of css.matchAll(pattern)) {
    if (!HANDLED_SEPARATELY.has(family) && !NOT_A_COLOR.has(family)) found.add(family)
  }
  return found
}

function collectSourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full))
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 소스에서 실제로 쓰인 위험한 정적 색 유틸리티를 계열별로 모은다 */
function collectRiskyUsage() {
  const usage = new Map() // family -> Map<property, Set<location>>
  // hover 변형은 posterHoverContrast.test.mjs가 따로 본다
  const pattern = /(?<![\w:-])(bg|text)-([a-z]+)-([0-9]+)/g

  for (const file of collectSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, 'utf8')
    const lines = source.split('\n')
    lines.forEach((line, i) => {
      for (const [, property, family, shade] of line.matchAll(pattern)) {
        if (HANDLED_SEPARATELY.has(family) || NOT_A_COLOR.has(family)) continue
        const risky = property === 'bg' ? LIGHT_BG_SHADES.has(shade) : DARK_TEXT_SHADES.has(shade)
        if (!risky) continue
        if (!usage.has(family)) usage.set(family, new Map())
        const byProp = usage.get(family)
        if (!byProp.has(property)) byProp.set(property, new Set())
        byProp.get(property).add(`${file}:${i + 1}`)
      }
    })
  }
  return usage
}

const bgFamilies = familiesOverriddenFor('bg')
const textFamilies = familiesOverriddenFor('text')

test('재매핑 목록이 비어 있지 않다 (셀렉터 형식이 바뀌면 이 검사가 헛돈다)', () => {
  assert.ok(bgFamilies.size > 5, `배경 재매핑 계열이 ${bgFamilies.size}개뿐이다 — 파서를 확인해라`)
  assert.ok(
    textFamilies.size > 5,
    `글자 재매핑 계열이 ${textFamilies.size}개뿐이다 — 파서를 확인해라`
  )
})

test('글자를 재매핑한 계열은 배경도 재매핑한다 (밝은 바탕 + 밝은 글씨 방지)', () => {
  const missing = [...textFamilies].filter(f => !bgFamilies.has(f)).sort()
  assert.deepEqual(
    missing,
    [],
    `globals.css의 [data-poster]가 다음 계열의 글자만 밝게 바꾸고 배경은 밝은 채로 둔다: ` +
      `${missing.join(', ')}. 밝은 바탕에 밝은 글씨가 되어 글자가 사라진다. ` +
      `배경 재매핑 셀렉터 목록에 bg-<계열>-를 추가해라.`
  )
})

test('배경을 재매핑한 계열은 글자도 재매핑한다 (어두운 바탕 + 어두운 글씨 방지)', () => {
  const missing = [...bgFamilies].filter(f => !textFamilies.has(f)).sort()
  assert.deepEqual(
    missing,
    [],
    `globals.css의 [data-poster]가 다음 계열의 배경만 어둡게 바꾸고 글자는 짙은 채로 둔다: ` +
      `${missing.join(', ')}. 어두운 바탕에 어두운 글씨가 되어 글자가 사라진다. ` +
      `글자 재매핑 셀렉터 목록에 text-<계열>-를 추가해라.`
  )
})

test('소스가 쓰는 색 계열은 모두 포스터 테마가 덮는다', () => {
  const usage = collectRiskyUsage()
  const gaps = []
  for (const [family, byProp] of usage) {
    const covered = bgFamilies.has(family) && textFamilies.has(family)
    if (covered) continue
    const where = [...byProp.values()]
      .flatMap(set => [...set])
      .sort()
      .slice(0, 5)
    gaps.push(`  ${family}: ${where.join(', ')}`)
  }
  assert.deepEqual(
    gaps,
    [],
    `포스터 테마가 덮지 않는 색 계열을 소스가 쓰고 있다:\n${gaps.join('\n')}\n` +
      `globals.css의 [data-poster] 배경·글자 재매핑에 해당 계열을 추가해라.`
  )
})
