// src/ 가 읽는 모든 process.env.X 가 scripts/verify-env.js 의 필수/선택 목록에 있는지 대조한다.
// 목록에 없는 변수는 운영자가 설정을 점검할 수 없어 "없어도 에러 없이 조용히 어긋나는" 사고가 된다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Next/Vercel/Node 가 주입하는 값이라 운영자가 설정하지 않는다.
const BUILT_INS = [
  /^NODE_ENV$/,
  /^VERCEL(_.*)?$/,
  /^NEXT_RUNTIME$/,
  /^NEXT_PHASE$/,
  /^CI$/,
  /^PORT$/,
  /^npm_.+$/,
]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

function readSrcEnvNames() {
  const names = new Set()
  for (const file of walk(path.join(root, 'src'))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  }
  return names
}

function readListed() {
  const text = fs.readFileSync(path.join(root, 'scripts', 'verify-env.js'), 'utf8')
  const listed = new Set()
  for (const name of ['requiredEnvVars', 'optionalEnvVars']) {
    const start = text.indexOf(`const ${name} = [`)
    assert.ok(start >= 0, `${name} 를 찾지 못했다`)
    const end = text.indexOf('\n]', start)
    for (const m of text.slice(start, end).matchAll(/^\s*'([A-Z][A-Z0-9_]*)',/gm)) listed.add(m[1])
  }
  return listed
}

test('src 가 읽는 모든 환경변수가 verify-env 목록에 있다', () => {
  const listed = readListed()
  const missing = [...readSrcEnvNames()]
    .filter(n => !BUILT_INS.some(re => re.test(n)))
    .filter(n => !listed.has(n))
    .sort()
  assert.deepEqual(missing, [], `verify-env.js 에 추가해야 할 변수: ${missing.join(', ')}`)
})
