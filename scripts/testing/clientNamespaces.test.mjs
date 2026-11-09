// 루트 레이아웃은 일부 네임스페이스만 클라이언트로 내려보낸다(src/i18n/segmentNamespaces.ts).
// 어떤 구간의 클라이언트 컴포넌트가 내려가지 않은 네임스페이스를 쓰면 런타임에 MISSING_MESSAGE가
// 나므로, 구간 디렉터리에서 import를 따라가며 useTranslations('ns')를 모아 provider와 대조한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { ROOT_NAMESPACES, SEGMENT_NAMESPACES } from '../../src/i18n/segmentNamespaces.ts'

const SRC = path.resolve('src')
const APP = path.join(SRC, 'app/[locale]')
const EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts']

function resolveImport(from, spec) {
  let base
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const e of EXTS) if (fs.existsSync(base + e)) return base + e
  return null
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(ent.name)) out.push(p)
  }
  return out
}

const cache = new Map()
function scan(file) {
  if (cache.has(file)) return cache.get(file)
  const src = fs.readFileSync(file, 'utf8')
  const used = []
  const noArg = /useTranslations\(\s*\)/.test(src)
  const dynamic = []
  for (const m of src.matchAll(/useTranslations\(\s*([^)]*?)\s*\)/g)) {
    if (!m[1]) continue
    const lit = m[1].match(/^['"`]([\w.]+)['"`]$/)
    if (lit) used.push(lit[1].split('.')[0])
    else dynamic.push(m[1])
  }
  const imports = []
  for (const m of src.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)) {
    const r = resolveImport(file, m[1])
    if (r) imports.push(r)
  }
  const res = { used, noArg, dynamic, imports }
  cache.set(file, res)
  return res
}

function reach(entries) {
  const seen = new Set()
  const stack = [...entries]
  const ns = new Map() // ns -> first file
  const noArg = []
  const dynamic = []
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    const s = scan(f)
    for (const n of s.used) if (!ns.has(n)) ns.set(n, path.relative(SRC, f))
    if (s.noArg) noArg.push(path.relative(SRC, f))
    for (const d of s.dynamic) dynamic.push(`${path.relative(SRC, f)}: ${d}`)
    stack.push(...s.imports)
  }
  return { ns, noArg, dynamic }
}

const segDirs = Object.keys(SEGMENT_NAMESPACES)
const ko = JSON.parse(fs.readFileSync('messages/ko.json', 'utf8'))
const en = JSON.parse(fs.readFileSync('messages/en.json', 'utf8'))

for (const seg of segDirs) {
  test(`구간 ${seg}: 클라이언트 네임스페이스가 provider에 포함된다`, () => {
    const dir = path.join(APP, seg)
    const { ns, noArg, dynamic } = reach(walk(dir))
    const allowed = new Set([...ROOT_NAMESPACES, ...SEGMENT_NAMESPACES[seg]])
    assert.deepEqual(noArg, [], `인자 없는 useTranslations()는 전체 트리를 요구한다: ${noArg}`)
    assert.deepEqual(dynamic, [], `동적 네임스페이스는 검증할 수 없다: ${dynamic}`)
    const missing = [...ns].filter(([n]) => !allowed.has(n)).map(([n, f]) => `${n} (${f})`)
    assert.deepEqual(missing, [], `${seg} provider에 빠진 네임스페이스`)
    const layout = fs.readFileSync(path.join(dir, 'layout.tsx'), 'utf8')
    assert.match(layout, /SegmentIntl/, `${seg}/layout.tsx가 SegmentIntl을 쓰지 않는다`)
    assert.ok(
      layout.includes(`SEGMENT_NAMESPACES['${seg}']`) ||
        layout.includes(`SEGMENT_NAMESPACES.${seg}`),
      `${seg}/layout.tsx가 SEGMENT_NAMESPACES 항목을 쓰지 않는다`
    )
  })
}

test('구간에 속하지 않는 페이지와 루트 레이아웃은 ROOT 네임스페이스만 쓴다', () => {
  const entries = [path.join(APP, 'layout.tsx')]
  for (const ent of fs.readdirSync(APP, { withFileTypes: true })) {
    const p = path.join(APP, ent.name)
    if (ent.isDirectory()) {
      if (!segDirs.includes(ent.name)) entries.push(...walk(p))
    } else if (/\.tsx?$/.test(ent.name)) entries.push(p)
  }
  const { ns, noArg, dynamic } = reach(entries)
  assert.deepEqual(noArg, [])
  assert.deepEqual(dynamic, [])
  const missing = [...ns]
    .filter(([n]) => !ROOT_NAMESPACES.includes(n))
    .map(([n, f]) => `${n} (${f})`)
  assert.deepEqual(missing, [], '루트 provider에 빠진 네임스페이스')
})

test('모든 네임스페이스가 ko/en 메시지에 존재한다', () => {
  const all = new Set([...ROOT_NAMESPACES, ...Object.values(SEGMENT_NAMESPACES).flat()])
  for (const n of all) {
    assert.ok(n in ko, `ko.json에 ${n} 없음`)
    assert.ok(n in en, `en.json에 ${n} 없음`)
  }
})
