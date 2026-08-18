/**
 * 포스터(다크) 테마의 밝은-테마 잔재 검사
 *
 * globals.css에는 손으로 쓴 밝은 테마 규칙이 섞여 있다(Quill 에디터, 업로드 바,
 * typography 플러그인 보정 등). 포스터 테마는 이들을 하나씩 덮어야 하는데,
 * 새 규칙을 추가할 때 포스터 쪽을 같이 손보지 않으면 다크 화면에서 글자가
 * 사라진다. 실제로 게시글 본문의 code·blockquote·th·dt·kbd가 1.13:1로,
 * Quill 에디터의 pre·code가 1.09:1로 보이지 않았다.
 *
 * 여기서는 두 가지를 정적으로 막는다.
 *  1) typography 플러그인이 요소별로 색을 직접 지정하는 태그는 포스터에서
 *     반드시 재지정한다. 부모 `.prose`에 색을 걸어도 직접 지정 규칙이 이기므로
 *     상속으로는 덮이지 않는다.
 *  2) 밝은 배경·어두운 글자를 지정하는 비포스터 규칙은 포스터 대응 규칙을
 *     갖거나, 이유를 적어 허용 목록에 올린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const GLOBALS = 'src/app/globals.css'

/** typography 플러그인이 색을 직접 지정하는 요소들 */
const PROSE_ELEMENTS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'a',
  'code',
  'blockquote',
  'th',
  'dt',
  'kbd',
  'figcaption',
]

/**
 * 포스터 대응이 없어도 되는 규칙과 그 이유.
 * 새로 추가할 때는 반드시 근거를 남긴다.
 */
const ALLOWLIST = new Map([
  ['::selection', '앰버 배경 + 검은 글자 조합이라 다크에서도 대비가 성립한다'],
  ['::-webkit-scrollbar-track', '파일 뒤쪽에서 전역으로 다시 선언해 덮는다'],
  ['.skeleton', '컴포넌트에서 쓰지 않는 죽은 CSS'],
  [
    '.bg-gray-100',
    '@media (prefers-contrast: high) 안에 있고, 이 질의는 크로미움에서 매칭되지 않는다',
  ],
])

function parseRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    sel: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }))
}

function luminanceOf(hex) {
  const n = parseInt(hex, 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function lightBackground(body) {
  const m = body.match(/background(?:-color)?:\s*([^;]+)/)
  if (!m) return null
  const value = m[1].trim()
  if (/^(white|#fff|#ffffff)\b/i.test(value)) return value
  const hex = value.match(/#([0-9a-f]{6})\b/i)
  return hex && luminanceOf(hex[1]) > 0.75 ? value : null
}

function darkForeground(body) {
  const m = body.match(/(?:^|;)\s*color:\s*([^;]+)/)
  if (!m) return null
  const value = m[1].trim()
  if (/^(black|#000|#000000)\b/i.test(value)) return value
  const hex = value.match(/#([0-9a-f]{6})\b/i)
  return hex && luminanceOf(hex[1]) < 0.45 ? value : null
}

test('포스터 테마가 .prose 요소별 색 지정을 모두 재지정한다', () => {
  const rules = parseRules(readFileSync(GLOBALS, 'utf8'))
  const covered = new Set()
  for (const r of rules) {
    for (const part of r.sel.split(',')) {
      const m = part.trim().match(/^\[data-poster\]\s+\.prose\s+([a-z0-9]+)$/)
      if (m && /(^|;)\s*color:/.test(r.body)) covered.add(m[1])
    }
  }
  const missing = PROSE_ELEMENTS.filter(e => !covered.has(e))
  assert.deepEqual(
    missing,
    [],
    `포스터에서 색을 재지정하지 않은 .prose 요소: ${missing.join(', ')}`
  )
})

test('밝은 배경·어두운 글자 규칙은 포스터 대응을 갖는다', () => {
  const rules = parseRules(readFileSync(GLOBALS, 'utf8'))
  const posterSelectors = new Set()
  for (const r of rules) {
    if (!r.sel.includes('[data-poster]')) continue
    for (const part of r.sel.split(',')) {
      posterSelectors.add(part.trim().replace(/\[data-poster\]\s*/, ''))
    }
  }

  const gaps = []
  for (const r of rules) {
    if (r.sel.includes('[data-poster]')) continue
    if (/^(@|:root|html|\*)/.test(r.sel)) continue
    const bg = lightBackground(r.body)
    const fg = darkForeground(r.body)
    if (!bg && !fg) continue
    for (const part of r.sel.split(',').map(s => s.trim())) {
      if (posterSelectors.has(part) || ALLOWLIST.has(part)) continue
      gaps.push(`${part}  (${[bg && `배경 ${bg}`, fg && `글자 ${fg}`].filter(Boolean).join(', ')})`)
    }
  }

  assert.deepEqual(
    gaps.sort(),
    [],
    `포스터 대응이 없는 밝은-테마 규칙:\n  ${gaps.join('\n  ')}\n` +
      `의도된 예외라면 이유와 함께 ALLOWLIST에 추가한다.`
  )
})

/**
 * 고대비 모드
 *
 * 이전 구현은 `(prefers-contrast: high)`를 물었다. 표준값은
 * no-preference|more|less|custom이라 `high`는 크로미움에서 매칭되지 않아
 * 블록 전체가 죽어 있었다. 게다가 내용이 밝은 테마 전제여서, 만약 매칭됐다면
 * !important로 흰 배경을 깔아 다크 테마의 글자를 지웠을 것이다.
 * 두 실수 모두 조용히 일어나므로 여기서 막는다.
 */

function contrastBlocks(css) {
  const out = []
  const re = /@media[^{]*prefers-contrast[^{]*\{/g
  for (const m of css.matchAll(re)) {
    // 중괄호 깊이를 세어 블록 끝을 찾는다
    let depth = 1
    let i = m.index + m[0].length
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
    }
    out.push({ query: m[0], body: css.slice(m.index + m[0].length, i - 1), start: m.index })
  }
  return out
}

test('고대비 질의가 표준값 more를 포함한다', () => {
  const blocks = contrastBlocks(readFileSync(GLOBALS, 'utf8'))
  assert.notEqual(blocks.length, 0, 'prefers-contrast 블록이 사라졌다')
  for (const b of blocks) {
    assert.match(
      b.query,
      /prefers-contrast:\s*more/,
      `표준값 more가 없어 크로미움에서 매칭되지 않는다: ${b.query.trim()}`
    )
  }
})

test('고대비 블록이 포스터 토큰 정의보다 뒤에 온다', () => {
  const css = readFileSync(GLOBALS, 'utf8')
  const tokenAt = css.indexOf('--poster-text:')
  assert.notEqual(tokenAt, -1, '--poster-text 정의를 찾지 못했다')
  for (const b of contrastBlocks(css)) {
    assert.ok(b.start > tokenAt, '고대비 블록이 토큰 정의보다 앞에 있어 재정의가 기본값에 덮인다')
  }
})

test('고대비 블록이 다크 테마에 밝은 배경을 강제하지 않는다', () => {
  const offenders = []
  for (const b of contrastBlocks(readFileSync(GLOBALS, 'utf8'))) {
    for (const r of parseRules(b.body)) {
      const bg = lightBackground(r.body)
      if (bg) offenders.push(`${r.sel} → ${bg}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `고대비 모드가 밝은 면을 깔면 흰 글자가 사라진다:\n  ${offenders.join('\n  ')}`
  )
})
