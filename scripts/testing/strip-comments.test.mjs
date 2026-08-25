import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

import { stripComments } from './strip-comments.mjs'

const root = process.cwd()

/**
 * 검증용 오라클 — `strip-comments.mjs`의 내부 구현을 쓰지 않고 여기서 다시
 * 짠다. TypeScript 파서가 인정한 **토큰**(주석·공백이 아닌 실제 코드)을
 * `종류:텍스트` 목록으로 뽑는다. 원본과 strip 결과의 이 목록이 완전히 같으면
 * "strip이 실제 코드를 하나도 건드리지 않았다"가 문자 단위로 증명된다.
 *
 * JSDoc 노드는 토큰이 아니라 주석이므로 제외한다.
 */
function tokenStream(source) {
  const sourceFile = ts.createSourceFile(
    'oracle.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const tokens = []
  const walk = node => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
      return
    const children = node.getChildren(sourceFile)
    if (children.length === 0) {
      const start = node.getStart(sourceFile, false)
      if (node.end > start) tokens.push(`${node.kind}:${source.slice(start, node.end)}`)
      return
    }
    for (const child of children) walk(child)
  }
  walk(sourceFile)
  return tokens
}

/**
 * 토큰이 덮지 않은 구간(트리비아) 가운데 공백이 아닌 문자, 즉 남아 있는 주석
 * 텍스트를 돌려준다. strip 결과에 대해 이 목록이 비어야 "주석을 놓치지
 * 않았다"가 증명된다 — 원래 결함(주석이 단정을 대신 만족시킴)의 회귀 검사다.
 */
function residualTrivia(source) {
  const sourceFile = ts.createSourceFile(
    'oracle.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const ranges = []
  const walk = node => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
      return
    const children = node.getChildren(sourceFile)
    if (children.length === 0) {
      const start = node.getStart(sourceFile, false)
      if (node.end > start) ranges.push([start, node.end])
      return
    }
    for (const child of children) walk(child)
  }
  walk(sourceFile)
  ranges.sort((a, b) => a[0] - b[0])

  const leftovers = []
  let covered = 0
  const scanGap = (start, end) => {
    const text = source.slice(start, end)
    if (text.trim() !== '') leftovers.push(text.trim())
  }
  for (const [start, end] of ranges) {
    if (start > covered) scanGap(covered, start)
    covered = Math.max(covered, end)
  }
  if (covered < source.length) scanGap(covered, source.length)
  return leftovers
}

const scanFiles = globSync('src/**/*.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
}).sort()

test('스캔 대상이 비어 있지 않다 (글롭이 깨지면 이 테스트가 공허하게 통과한다)', () => {
  assert.ok(
    scanFiles.length >= 380,
    `src/ 아래 ts/tsx가 ${scanFiles.length}개뿐이다 — 글롭이 깨졌거나 저장소가 아니다`
  )
})

test('stripComments는 저장소 전체에서 실제 코드 토큰을 하나도 지우지 않는다', () => {
  const damaged = []
  for (const file of scanFiles) {
    const original = readFileSync(join(root, file), 'utf8')
    const stripped = stripComments(original)
    assert.equal(
      stripped.length,
      original.length,
      `${file}: strip이 길이를 바꿨다 — 위치 보존이 깨지면 대조가 성립하지 않는다`
    )
    const before = tokenStream(original)
    const after = tokenStream(stripped)
    if (before.length !== after.length || before.some((tok, i) => tok !== after[i])) {
      const firstDiff = before.findIndex((tok, i) => tok !== after[i])
      damaged.push(
        `${file}: 토큰 ${before.length}개 → ${after.length}개, 첫 불일치 #${firstDiff} ${JSON.stringify(
          before[firstDiff]
        )} → ${JSON.stringify(after[firstDiff])}`
      )
    }
  }
  assert.deepEqual(
    damaged,
    [],
    `stripComments가 주석이 아닌 실제 코드를 지웠다:\n${damaged.join('\n')}`
  )
})

test('stripComments는 저장소 전체에서 주석을 하나도 남기지 않는다', () => {
  const leftovers = []
  for (const file of scanFiles) {
    const stripped = stripComments(readFileSync(join(root, file), 'utf8'))
    const residual = residualTrivia(stripped)
    if (residual.length > 0) leftovers.push(`${file}: ${residual.slice(0, 2).join(' / ')}`)
  }
  assert.deepEqual(
    leftovers,
    [],
    `strip 결과에 주석이 남았다 — 주석이 단정을 대신 만족시키는 원래 결함이 되살아난다:\n${leftovers.join('\n')}`
  )
})

// ── 리뷰 1회차가 실증한 정규식 구현의 두 실패 모드 ──────────────────────────
// 두 픽스처 모두 옛 구현
//   source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
// 에서는 실제 코드가 사라졌다.

test('문자열 안의 /* 가 블록 주석을 열지 않는다 (commentNotify.ts 실패 모드)', () => {
  const source = [
    `import { createClient } from '@supabase/supabase-js'`,
    `const GLOB = 'src/db/queries/*.ts'`,
    `/** 아래 JSDoc의 끝이 옛 구현에서 위 문자열과 짝지어졌다. */`,
    `const log = () => {}`,
  ].join('\n')
  const stripped = stripComments(source)
  assert.match(stripped, /import \{ createClient \} from '@supabase\/supabase-js'/)
  assert.match(stripped, /const GLOB = 'src\/db\/queries\/\*\.ts'/)
  assert.match(stripped, /const log = \(\) => \{\}/)
  assert.doesNotMatch(stripped, /JSDoc의 끝/)
})

test('JSX 속성 안의 image/* 가 블록 주석을 열지 않는다 (업로드 JSX 실패 모드)', () => {
  const source = [
    `export function Upload() {`,
    `  return <input type="file" accept="image/*" />`,
    `}`,
    `/* 이 주석은 사라져야 한다 */`,
    `export const AFTER = 1`,
  ].join('\n')
  const stripped = stripComments(source)
  assert.match(stripped, /accept="image\/\*"/)
  assert.match(stripped, /export const AFTER = 1/)
  assert.doesNotMatch(stripped, /이 주석은 사라져야 한다/)
})

test('문자열·정규식 리터럴 안의 // 가 줄 주석을 열지 않는다', () => {
  const source = [
    `const isProtocolRelative = url.startsWith('//')`,
    `const normalized = raw.replace(/\\/\\//g, ':') // 이 꼬리 주석만 사라져야 한다`,
    `const KEEP = 'kept'`,
  ].join('\n')
  const stripped = stripComments(source)
  assert.match(stripped, /url\.startsWith\('\/\/'\)/)
  assert.match(stripped, /raw\.replace\(\/\\\/\\\/\/g, ':'\)/)
  assert.match(stripped, /const KEEP = 'kept'/)
  assert.doesNotMatch(stripped, /이 꼬리 주석만/)
})

test('주석 처리된 코드는 여전히 사라진다 (가드가 주석에 속지 않는다)', () => {
  const source = [`// await removeAttachment(attachmentId, postId)`, `const x = 1`].join('\n')
  const stripped = stripComments(source)
  assert.doesNotMatch(stripped, /removeAttachment/)
  assert.match(stripped, /const x = 1/)
})

// ── 리뷰가 지목한 실제 피해 파일 두 곳을 이름으로 못박는다 ──────────────────
// 저장소 전수 대조가 이미 덮지만, 회귀했을 때 실패 메시지가 곧바로 원인을
// 가리키도록 남긴다.
test('리뷰가 지목한 피해 파일의 import 블록이 strip 후에도 살아 있다', () => {
  const cases = [
    ['src/lib/server/commentNotify.ts', /^import\s/m],
    ['src/middleware/session.ts', /^import\s/m],
  ]
  for (const [file, pattern] of cases) {
    const stripped = stripComments(readFileSync(join(root, file), 'utf8'))
    assert.match(stripped, pattern, `${file}: strip 후 import 블록이 사라졌다`)
  }
})

test('파서가 소스를 온전히 읽지 못하면 조용히 통과하지 않고 throw한다', () => {
  // git 충돌 표식은 TypeScript 파서가 토큰으로 인정하지 않아 트리비아 구간에
  // 주석 아닌 문자로 남는다. 그런 소스를 "주석을 다 걷어냈다"며 돌려주면
  // 가드가 눈먼 채 통과하므로, 조용히 넘어가지 않고 실패해야 한다.
  const conflicted = [
    '<<<<<<< HEAD',
    'const a = 1',
    '=======',
    'const a = 2',
    '>>>>>>> other',
  ].join('\n')
  assert.throws(() => stripComments(conflicted), {
    message: /토큰이 덮지 않은 구간에 주석이 아닌 문자가 남았다/,
  })
})

test('닫히지 않은 블록 주석은 파일 끝까지 주석으로 취급해 걷어낸다', () => {
  const stripped = stripComments('const a = 1\n/* 닫히지 않았다\nconst b = 2\n')
  assert.match(stripped, /const a = 1/)
  assert.doesNotMatch(stripped, /const b = 2/)
})
