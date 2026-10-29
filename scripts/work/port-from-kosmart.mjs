#!/usr/bin/env node
/**
 * kosmart-work 원본 파일을 이사회 업무툴(`src/work/`)로 옮긴다 — docs/board-work/01-설계.md §2-2·§9.
 *
 *   node scripts/work/port-from-kosmart.mjs src/components/ui/button.tsx src/lib/utils.ts …
 *   node scripts/work/port-from-kosmart.mjs --check src/work/components/ui/button.tsx   (변환만 다시 돌려 차이 확인)
 *
 * 하는 일(파일마다):
 *   1. 원본 `<KOSMART_WORK_DIR>/src/<경로>` → `src/work/<경로>`로 복사한다(`src/` 접두사를 뗀다).
 *   2. import 경로를 바꾼다: `@/lib|components|types|hooks/…` → `@work/…`, `lucide-react` → `lucide-work`
 *      (lucide 1.x를 별칭으로 따로 설치했다 — ggac 본체는 0.x를 그대로 쓴다).
 *   3. 문자열 리터럴 안의 Tailwind v4 클래스를 v3로 바꾼다(`convertToken`). 원본은 v4, ggac는 3.4다.
 *   4. `src/work/ported.json`에 원본 경로·커밋·원본 해시를 남긴다 — 원본이 바뀌었는지 나중에 대조한다.
 *
 * 이미 있는 대상 파일은 덮어쓰지 않는다(`--force`로만). 옮긴 뒤 손으로 고친 내용을 지우지 않기 위해서다.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const KOSMART = process.env.KOSMART_WORK_DIR || path.join(process.env.HOME, 'kosmart-work')
const LEDGER = path.join(ROOT, 'src/work/ported.json')

// ── 1. import 경로 ────────────────────────────────────────────────────────────

export function rewriteSpecifier(spec) {
  if (spec === 'lucide-react') return 'lucide-work'
  const m = /^@\/(lib|components|types|hooks)(\/.*)?$/.exec(spec)
  if (m) return `@work/${m[1]}${m[2] ?? ''}`
  return spec
}

// ── 2. Tailwind v4 → v3 ──────────────────────────────────────────────────────

/** shadcn `tailwind.css`가 정의한 의미 변형 — tailwind.config.js 플러그인이 같은 이름으로 다시 정의한다. 그대로 둔다. */
const SHADCN_DATA_VARIANTS = new Set([
  'open',
  'closed',
  'checked',
  'unchecked',
  'selected',
  'disabled',
  'active',
  'horizontal',
  'vertical',
])

/** v4 크기 이름 → v3. 원본 `@theme`가 반경을 `--radius` 배수로 다시 정의해서, ggac 전역 `rounded-lg`와 섞이지 않게 `w-` 접두사를 붙인다. */
const RADIUS_SIZES = new Set(['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'])

/** `a:b:[c:d]:e` → ['a','b','[c:d]','e'] — 대괄호·소괄호 안의 콜론은 자르지 않는다. */
export function splitVariants(token) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of token) {
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    if (ch === ':' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts
}

export function convertVariant(v) {
  if (v === '**') return '[&_*]'
  let m
  // data-foo(v4 불리언 단축) — shadcn 의미 변형이 아니면 v3 임의 값으로
  if ((m = /^data-([a-z][a-z0-9-]*)$/.exec(v))) {
    return SHADCN_DATA_VARIANTS.has(m[1]) ? v : `data-[${m[1]}]`
  }
  // group-data-foo/name, peer-data-foo/name
  if ((m = /^(group|peer)-data-([a-z][a-z0-9-]*)(\/[\w-]+)?$/.exec(v))) {
    const sel = SHADCN_DATA_SELECTORS[m[2]] ?? m[2]
    return `${m[1]}-data-[${sel}]${m[3] ?? ''}`
  }
  if ((m = /^in-data-\[(.+)\]$/.exec(v))) return `[[data-${m[1]}]_&]`
  if ((m = /^in-data-([a-z][a-z0-9-]*)$/.exec(v))) return `[[data-${m[1]}]_&]`
  if ((m = /^not-data-\[(.+)\]$/.exec(v))) return `[&:not([data-${m[1]}])]`
  if ((m = /^not-data-([a-z][a-z0-9-]*)$/.exec(v))) return `[&:not([data-${m[1]}])]`
  if ((m = /^not-aria-\[(.+)\]$/.exec(v))) return `[&:not([aria-${m[1]}])]`
  if ((m = /^(group-|peer-)?has-data-\[(.+)\](\/[\w-]+)?$/.exec(v))) {
    return `${m[1] ?? ''}has-[[data-${m[2]}]]${m[3] ?? ''}`
  }
  if ((m = /^(group-|peer-)?has-data-([a-z][a-z0-9-]*)(\/[\w-]+)?$/.exec(v))) {
    return `${m[1] ?? ''}has-[[data-${m[2]}]]${m[3] ?? ''}`
  }
  if ((m = /^(group-|peer-)?has-(disabled|checked|focus-visible|focus)(\/[\w-]+)?$/.exec(v))) {
    return `${m[1] ?? ''}has-[:${m[2]}]${m[3] ?? ''}`
  }
  if ((m = /^supports-([a-z][a-z-]*)$/.exec(v))) return `supports-[${m[1]}]`
  if (v === 'aria-invalid') return 'aria-[invalid=true]'
  return v
}

/** group-data-* 를 임의 값으로 풀 때 shadcn 의미 변형과 같은 선택자를 쓴다. */
const SHADCN_DATA_SELECTORS = {
  selected: 'selected=true',
  horizontal: 'orientation=horizontal',
  vertical: 'orientation=vertical',
}

export function convertUtility(u) {
  let important = false
  if (u.startsWith('!')) {
    important = true
    u = u.slice(1)
  } else if (u.endsWith('!')) {
    important = true
    u = u.slice(0, -1)
  }
  let neg = ''
  if (u.startsWith('-')) {
    neg = '-'
    u = u.slice(1)
  }
  let m
  // tw-animate-css → 업무툴 전용 wa-* (tailwind.config.js workAnimations)
  if (u === 'animate-in') u = 'wa-in'
  else if (u === 'animate-out') u = 'wa-out'
  else if ((m = /^(fade|zoom)-(in|out)-(.+)$/.exec(u))) u = `wa-${m[1]}-${m[2]}-${m[3]}`
  else if ((m = /^slide-(in-from|out-to)-(top|bottom|left|right)-(.+)$/.exec(u)))
    u = `wa-slide-${m[1]}-${m[2]}-${m[3]}`
  else if (u === 'outline-hidden') u = 'outline-none'
  else if (u === 'ring-3') u = 'ring'
  else if (u === 'shadow-sm') u = 'shadow'
  else if (u === 'shadow-xs') u = 'shadow-sm'
  else if (u === 'backdrop-blur-xs') u = 'backdrop-blur-sm'
  else if (u === 'blur-xs') u = 'blur-sm'
  else if ((m = /^field-sizing-(content|fixed)$/.exec(u))) u = `[field-sizing:${m[1]}]`
  else if ((m = /^bg-linear-(to-[trbl]{1,2})$/.exec(u))) u = `bg-gradient-${m[1]}`
  else if ((m = /^rounded(-[trblse]{1,2})?-([a-z0-9]+)$/.exec(u)) && RADIUS_SIZES.has(m[2])) {
    u = `rounded${m[1] ?? ''}-w-${m[2]}`
  } else if ((m = /^([a-z][\w-]*?)-\((--[\w-]+)\)(\/[\w.]+)?$/.exec(u))) {
    // w-(--anchor-width) → w-[var(--anchor-width)]
    u = `${m[1]}-[var(${m[2]})]${m[3] ?? ''}`
  }
  return `${important ? '!' : ''}${neg}${u}`
}

/** 클래스처럼 생긴 토큰만 바꾼다(문장·경로·URL은 건너뛴다). */
const CLASS_TOKEN = /^[!@*a-z[(-][^\s]*$/

/**
 * v4는 겹친 변형을 **왼쪽부터** 적용하고 v3는 **오른쪽부터** 적용한다(v4 업그레이드 안내: v3 `first:*:pt-0` = v4 `*:first:pt-0`).
 * 그래서 변형 순서를 뒤집는다. 미디어 쿼리·의사 클래스끼리는 순서가 결과를 바꾸지 않으므로 뒤집어도 같고,
 * `*:`·`[&_svg]:`처럼 선택자를 바꾸는 변형이 섞일 때만 의미가 달라진다 — 뒤집어야 원본과 같은 선택자가 된다.
 *
 * `&` 없는 임의 변형(`*:[svg]:`·`**:[[cmdk-group-heading]]:`)은 v4에서 `&:is(X)`로 해석된다. v3는 `&`가 꼭 있어야 하므로 명시한다.
 */
export function convertToken(token) {
  if (!CLASS_TOKEN.test(token) || token.includes('${') || token.includes('://')) return token
  const parts = splitVariants(token)
  const util = parts.pop()
  if (parts.length === 0) return convertUtility(util)
  const variants = parts.map(convertVariant).map(v => {
    const m = /^\[([^@].*)\]$/.exec(v)
    return m && !m[1].includes('&') ? `[&:is(${m[1]})]` : v
  })
  // 순서가 결과를 바꾸는 것은 선택자를 고치는 변형이 둘 이상 섞일 때뿐이다. 그 밖에는 원본 순서를 둔다 —
  // 클래스가 아닌 `a:b:c` 꼴 문자열을 잘못 뒤집을 위험도 그만큼 준다.
  const reorder = variants.length > 1 && variants.some(v => /^(\[|\*)/.test(v))
  return [...(reorder ? variants.reverse() : variants), convertUtility(util)].join(':')
}

export function convertClassString(s) {
  return s.replace(/[^\s]+/g, tok => convertToken(tok))
}

// ── 3. 소스 변환(TypeScript AST로 문자열·import만 건드린다) ───────────────────

export function transformSource(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName))
  const edits = []
  const visit = node => {
    // import/export 경로
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      pushSpecifier(node.moduleSpecifier)
      return
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      pushSpecifier(node.arguments[0])
      return
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const lit = node.argument.literal
      if (ts.isStringLiteral(lit)) pushSpecifier(lit)
    }
    // 문자열 안의 클래스
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      pushText(node.getStart(sf) + 1, node.getEnd() - 1)
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      pushText(node.getStart(sf) + 1, node.getEnd() - 2)
    } else if (ts.isTemplateTail(node)) {
      pushText(node.getStart(sf) + 1, node.getEnd() - 1)
    }
    ts.forEachChild(node, visit)
  }
  const pushSpecifier = lit => {
    const next = rewriteSpecifier(lit.text)
    if (next !== lit.text) edits.push([lit.getStart(sf) + 1, lit.getEnd() - 1, next])
  }
  const pushText = (start, end) => {
    const raw = text.slice(start, end)
    const next = convertClassString(raw)
    if (next !== raw) edits.push([start, end, next])
  }
  visit(sf)
  edits.sort((a, b) => b[0] - a[0])
  let out = text
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e)
  return out
}

function scriptKind(fileName) {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (fileName.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

// ── 4. CLI ───────────────────────────────────────────────────────────────────

function kosmartCommit() {
  return execFileSync('git', ['-C', KOSMART, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
}

function readLedger() {
  return fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {}
}

function main(argv) {
  const force = argv.includes('--force')
  const files = argv.filter(a => !a.startsWith('--'))
  if (files.length === 0) {
    console.error('사용법: port-from-kosmart.mjs [--force] src/<원본 경로>…')
    process.exit(2)
  }
  const commit = kosmartCommit()
  const ledger = readLedger()
  let wrote = 0
  for (const rel of files) {
    if (!rel.startsWith('src/')) throw new Error(`원본 경로는 src/로 시작해야 한다: ${rel}`)
    const src = path.join(KOSMART, rel)
    const dest = path.join(ROOT, 'src/work', rel.slice('src/'.length))
    if (fs.existsSync(dest) && !force) {
      console.log(`건너뜀(이미 있음): ${path.relative(ROOT, dest)}`)
      continue
    }
    const original = fs.readFileSync(src, 'utf8')
    const converted = /\.(tsx?|jsx?|mjs)$/.test(rel) ? transformSource(original, rel) : original
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, converted)
    ledger[path.relative(ROOT, dest)] = {
      source: rel,
      commit,
      sha256: createHash('sha256').update(original).digest('hex').slice(0, 16),
    }
    wrote++
    console.log(`옮김: ${rel} → ${path.relative(ROOT, dest)}`)
  }
  const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)))
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
  fs.writeFileSync(LEDGER, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`${wrote}개 옮김 (원본 ${commit})`)
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
