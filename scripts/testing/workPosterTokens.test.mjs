/**
 * 이사회 업무툴 디자인 토큰 = ggac 포스터 팔레트 검사
 *
 * 업무툴 컴포넌트는 `bg-background`·`text-muted-foreground` 같은 토큰 클래스를 쓴다. 이 클래스는 포스터의
 * 속성 셀렉터 재매핑(`[data-poster] .bg-white` …)에 걸리지 않으므로, 업무툴이 포스터 테마로 보이는 것은 전부
 * `src/work/styles.css`의 토큰 값에 달려 있다(docs/board-work/03-통합-재설계.md §4-4).
 *
 * 그래서 이 테스트는
 * 1. 토큰 블록이 **딱 한 벌**(다크)이고 밝은 테마·OS 다크·수동 다크(`data-work-theme`) 분기가 다시 생기지 않았는지,
 * 2. 각 토큰 값이 §4-4 표의 포스터 값과 같은지 — 면·선·글자는 globals.css `--poster-*`에서 직접 읽어 비교한다,
 * 3. 업무툴이 전역 `:focus-visible` outline을 끄는 규칙이 되살아나지 않았는지,
 * 4. tailwind.config.js의 업무툴 색 이름이 가리키는 변수가 전부 정의돼 있고 `dark:` 변형이 켜지지 않는지
 * 를 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const WORK_CSS = 'src/work/styles.css'
const GLOBALS_CSS = 'src/app/globals.css'

/** 주석을 지운 CSS */
function readCss(path) {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** `selector { --a: x; ... }` 블록 중 커스텀 속성을 선언한 것만 [{ selector, vars }]로 */
function tokenBlocks(css) {
  const blocks = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const vars = {}
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim()
    if (Object.keys(vars).length > 0) blocks.push({ selector: m[1].trim(), vars })
  }
  return blocks
}

/** 색 문자열 비교용 정규화(공백·대소문자·소수 앞 0) */
function norm(v) {
  return v
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(^|[(,])0\./g, '$1.')
    .replace(/^#fff$/, '#ffffff')
    .replace(/^#000$/, '#000000')
}

const workCss = readCss(WORK_CSS)
const blocks = tokenBlocks(workCss)
const tokens = blocks.find(b => '--background' in b.vars)?.vars ?? {}

function posterVar(name) {
  const block = tokenBlocks(readCss(GLOBALS_CSS)).find(b => b.selector === '[data-poster]')
  assert.ok(block, 'globals.css에 [data-poster] 토큰 블록이 있어야 한다')
  const v = block.vars[name]
  assert.ok(v, `globals.css [data-poster]에 ${name}이 있어야 한다`)
  return v
}

test('토큰 블록은 다크 한 벌이고 업무툴 루트와 포털(body:has) 둘 다에 걸린다', () => {
  const withBackground = blocks.filter(b => '--background' in b.vars)
  assert.equal(
    withBackground.length,
    1,
    '`--background`를 정하는 블록은 하나뿐이어야 한다(라이트·다크 분기 금지)'
  )
  const selectors = withBackground[0].selector.split(',').map(s => s.trim())
  assert.deepEqual(selectors.sort(), ['[data-work-app]', 'body:has([data-work-app])'].sort())

  assert.doesNotMatch(workCss, /prefers-color-scheme/, 'OS 테마 분기를 두지 않는다')
  assert.doesNotMatch(workCss, /data-work-theme/, '수동 테마 속성 분기를 두지 않는다')
  assert.match(workCss, /color-scheme:\s*dark/)
  assert.doesNotMatch(workCss, /color-scheme:\s*light/)
  assert.doesNotMatch(workCss, /oklch\(/, '원본 oklch 팔레트 값이 남아 있으면 안 된다')
})

test('토큰 값이 포스터 팔레트와 같다(03-통합-재설계 §4-4)', () => {
  const surface = posterVar('--poster-surface') // #101014
  const surface2 = posterVar('--poster-surface-2') // #16161b
  const line = posterVar('--poster-line') // 흰 15%
  const text = posterVar('--poster-text') // 흰 92%
  const text2 = posterVar('--poster-text-2') // 흰 72%
  const text3 = posterVar('--poster-text-3') // 흰 55%
  const amber = '#fbd9a5'

  const expected = {
    '--background': surface2,
    '--foreground': text,
    '--card': surface,
    '--card-foreground': text,
    '--popover': surface2,
    '--popover-foreground': text,
    '--primary': '#ffffff',
    '--primary-foreground': '#000000',
    '--secondary': surface2,
    '--secondary-foreground': text,
    '--muted': surface2,
    '--muted-foreground': text3,
    '--accent': 'rgba(255, 255, 255, 0.12)',
    '--accent-foreground': text,
    '--destructive': '#fca5a5',
    '--border': line,
    '--input': line,
    '--ring': '#0ea5e9',
    '--radius': '2px',
    '--sidebar': surface,
    '--sidebar-foreground': text2,
    '--sidebar-primary': '#ffffff',
    '--sidebar-primary-foreground': '#000000',
    '--sidebar-accent': 'rgba(255, 255, 255, 0.12)',
    '--sidebar-accent-foreground': text,
    '--sidebar-border': line,
    '--sidebar-ring': '#0ea5e9',
    '--unread': text,
    '--unread-dot': amber,
    '--mention': amber,
    '--mention-solid': amber,
    '--mention-solid-foreground': '#000000',
    '--highlight': amber,
    '--highlight-foreground': '#000000',
    '--online': '#86efac',
    // R3 컴포넌트 재스킨(§4-5)
    '--subtle': 'rgba(255, 255, 255, 0.07)',
    '--subtle-foreground': text2,
    '--disabled': 'rgba(255, 255, 255, 0.14)',
    '--disabled-foreground': 'rgba(255, 255, 255, 0.45)',
  }
  for (const [name, value] of Object.entries(expected)) {
    assert.ok(name in tokens, `${name}이 정의돼 있어야 한다`)
    assert.equal(norm(tokens[name]), norm(value), `${name}`)
  }
})

test('반경 변수는 전부 --radius(2px)의 배수다', () => {
  for (const size of ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl']) {
    const v = tokens[`--radius-${size}`]
    assert.ok(v, `--radius-${size}`)
    assert.match(v, /var\(--radius\)/, `--radius-${size}는 --radius에서 나와야 한다`)
  }
})

test('업무툴이 전역 :focus-visible outline을 끄지 않는다', () => {
  assert.doesNotMatch(
    workCss,
    /outline:\s*none/,
    '전역 포커스 윤곽(#0ea5e9)을 업무툴에서 끄면 안 된다'
  )
  assert.doesNotMatch(workCss, /:focus-visible/, '포커스 모양은 globals.css 한 곳이 정한다')
})

test('tailwind 업무툴 색 이름이 가리키는 변수는 전부 정의돼 있고 dark: 변형은 켜지지 않는다', () => {
  const require = createRequire(import.meta.url)
  const src = readFileSync('tailwind.config.js', 'utf8')
  const referenced = [...src.matchAll(/wc\('([\w-]+)'\)/g)].map(m => `--${m[1]}`)
  assert.ok(referenced.length > 20)
  for (const name of referenced)
    assert.ok(name in tokens, `${name}(workColors)이 styles.css에 없다`)

  const config = require('../../tailwind.config.js')
  // 키가 없으면 v3 기본값 'media'라 OS 다크에서 업무툴에 남은 `dark:` 클래스가 켜진다
  assert.ok(config.darkMode, 'darkMode를 비워 두면 기본값 media가 된다')
  assert.notEqual(config.darkMode, 'media')
  const serialized = JSON.stringify(config.darkMode)
  assert.doesNotMatch(serialized, /prefers-color-scheme|data-work-theme|data-work-app/)
})
