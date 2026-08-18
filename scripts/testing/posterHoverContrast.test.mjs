/**
 * 포스터(다크) 테마의 hover 변형 대비 검사
 *
 * globals.css의 포스터 테마는 밝은 테마 유틸리티를 속성 셀렉터
 * (`[class*=' bg-gray-5']`)로 재매핑한다. 그런데 Tailwind가 `hover:bg-gray-50`을
 * 내보낼 때 class 문자열은 `hover:bg-gray-50`이라 `bg-gray-5` 앞이 공백이 아니라
 * `:`다. 즉 속성 셀렉터에 걸리지 않는다.
 *
 * 결과: 정적 배경·글자는 다크로 재매핑되는데 hover 상태만 밝은 테마 값으로
 * 되돌아간다. 알림 드롭다운에서 hover 시 흰 배경 위 흰 글자가 되어 내용이
 * 사라진 것이 이 경우였다.
 *
 * 이 테스트는 코드베이스가 쓰는 hover 변형 중 "밝은 면"과 "어두운 글자"에
 * 해당하는 것들이 포스터 테마에서 명시적으로 덮여 있는지 정적으로 검증한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = 'src'
const GLOBALS_CSS = 'src/app/globals.css'

/** 다크 면 위에서 배경이 밝아져 글자를 삼키는 계단 */
const LIGHT_BG_SHADES = new Set(['50', '100', '200', '300'])
/** 다크 면 위에서 글자가 어두워져 읽히지 않는 계단 */
const DARK_TEXT_SHADES = new Set(['600', '700', '800', '900'])

function collectTsxFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectTsxFiles(full))
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 소스에서 쓰인 hover/group-hover 색상 유틸리티 중 포스터 테마에서
 * 덮여야 하는 것만 추린다.
 */
function collectRiskyHoverUtilities() {
  const risky = new Map() // utility -> Set<file>
  const pattern = /(?:group-)?hover:(bg|text)-([a-z]+)-([0-9]+)(?:\/[0-9]+)?/g

  for (const file of collectTsxFiles(SRC_DIR)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const [utility, property, hue, shade] = match
      // bg-opacity-50 등은 색상 유틸리티가 아니다
      if (hue === 'opacity') continue
      const risky_shade =
        property === 'bg' ? LIGHT_BG_SHADES.has(shade) : DARK_TEXT_SHADES.has(shade)
      if (!risky_shade) continue

      // 불투명도 수식자는 벗기지 않는다. Tailwind는 `hover:bg-primary-50/50`을
      // `.hover\:bg-primary-50\/50`이라는 별개 클래스로 내보내므로,
      // `.hover\:bg-primary-50`을 덮어도 이쪽은 덮이지 않는다. FAQ 아코디언이 그랬다.
      if (!risky.has(utility)) risky.set(utility, new Set())
      risky.get(utility).add(file)
    }
  }
  return risky
}

/** globals.css에서 포스터 테마가 덮고 있는 hover 유틸리티 이름을 뽑는다 */
function collectPosterHoverOverrides(css) {
  const covered = new Set()
  // hover는 `[data-poster] .hover\:bg-gray-50:hover`,
  // group-hover는 `[data-poster] .group:hover .group-hover\:text-primary-600` 형태다.
  const posterRules = css.match(/\[data-poster\][^{}]*\{[^}]*\}/g) ?? []
  for (const rule of posterRules) {
    const selector = rule.slice(0, rule.indexOf('{'))
    // 셀렉터의 이스케이프(`\\/`)를 벗겨 소스 표기(`/50`)와 맞춘다
    for (const match of selector.matchAll(
      /\.((?:group-)?hover)\\:([a-z]+-[a-z]+-[0-9]+(?:\\\/[0-9]+)?)/g
    )) {
      covered.add(`${match[1]}:${match[2].replace(/\\/g, '')}`)
    }
  }
  return covered
}

test('포스터 테마가 밝은 hover 배경 유틸리티를 모두 덮는다', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8')
  const covered = collectPosterHoverOverrides(css)
  const risky = collectRiskyHoverUtilities()

  const uncovered = [...risky.entries()]
    .filter(([utility]) => utility.includes(':bg-'))
    .filter(([utility]) => !covered.has(utility))
    .map(([utility, files]) => `${utility} (예: ${[...files][0]})`)
    .sort()

  assert.deepEqual(
    uncovered,
    [],
    `포스터 테마에서 hover 시 밝은 면으로 되돌아가는 유틸리티:\n  ${uncovered.join('\n  ')}`
  )
})

test('포스터 테마가 어두운 hover 글자 유틸리티를 모두 덮는다', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8')
  const covered = collectPosterHoverOverrides(css)
  const risky = collectRiskyHoverUtilities()

  const uncovered = [...risky.entries()]
    .filter(([utility]) => utility.includes(':text-'))
    .filter(([utility]) => !covered.has(utility))
    .map(([utility, files]) => `${utility} (예: ${[...files][0]})`)
    .sort()

  assert.deepEqual(
    uncovered,
    [],
    `포스터 테마에서 hover 시 어두운 글자로 되돌아가는 유틸리티:\n  ${uncovered.join('\n  ')}`
  )
})
