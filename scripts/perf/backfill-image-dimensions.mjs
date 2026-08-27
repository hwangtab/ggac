// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// 이 스크립트는 `--apply` 시 Supabase `posts.content`·`board_minutes.content`를
// UPDATE한다(본문 img에 width/height를 주입해 CLS를 줄이는 백필).
//
// 컷오버(2026-08-26) 이후 앱은 Supabase를 어디에서도 읽지 않는다. 그런데
// `.env.local`에 Supabase 값이 남아 있으면 이 스크립트는 **버려진 사본을
// 건드리고 성공 메시지를 내고 끝난다** — 화면은 그대로인데 아무도 이유를
// 모른다. 조용한 성공이 이 저장소에서 가장 비싼 실패이므로 아래 가드가
// 무조건 막는다. 지금 이걸 막고 있는 건 `dotenv` 미설치나 따옴표 파싱
// 실패 같은 **우연**이었다 — `npm i dotenv` 한 번이나
// `set -a; source .env.local; set +a`(scripts/turso/README.md가 DB 작업 전에
// 하라고 안내하는 바로 그 명령)면 그 우연은 사라진다.
//
// 동기(CLS 개선)는 여전히 정당하지만 대상 DB가 틀렸다. 본문의 권위는 Turso
// `posts`·`board_minutes`다(`src/db/schema/content.ts`·`src/db/schema/board.ts`).
// 게다가 주입 판정에 쓰는 `isSupabaseImageUrl`(`src/utils/imageDimensions.ts`)은
// Supabase Storage origin을 보는데, 이미지는 이미 Vercel Blob으로 옮겨졌다 —
// Turso로 포팅할 때 그 호스트 판정도 함께 고쳐야 한다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase `posts`·`board_minutes`의 content를 덮어씁니다. ' +
    '본문의 권위는 Turso이고 이미지 호스트도 Vercel Blob으로 바뀌었습니다 — ' +
    '실행해도 CLS는 그대로입니다. Turso + Blob 기준으로 포팅한 뒤에 쓰십시오.'
)
process.exit(1)
// scripts/perf/backfill-image-dimensions.mjs
//
// 본문 HTML 이미지에 width/height를 백필해 CLS(레이아웃 이동)를 줄인다.
// Task 1의 annotateImageDimensions(실 리졸버: fetch + sharp)를 기존 행에 적용한다.
// 저장 경로(Task 2)가 신규 콘텐츠를 처리하는 것과 동일한 유틸을 기존 행에 1회성으로 돌린다.
//
// 사용법:
//   node scripts/perf/backfill-image-dimensions.mjs            # DRY-RUN (기본, DB 쓰기 전혀 없음)
//   node scripts/perf/backfill-image-dimensions.mjs --apply    # 변경분만 content 컬럼 update
//
// 대상 테이블: posts(content_format='html'), board_minutes(content_format='html')
// 변경 판정: annotateImageDimensions(content) !== 원본 content.
// --apply 시 content 컬럼만 갱신한다(content_format 및 그 밖의 모든 컬럼 불변).
//
// 멱등(idempotent): --apply 후 재실행하면 이미 width/height가 있는 img는 유틸이 스킵하므로
// (그리고 주입할 supabase 이미지가 없으면 유틸이 원본을 그대로 반환하므로) 변경 건수는 ~0이 된다.
//
// 안전장치:
//  - 로컬 Supabase(URL에 54321 포함) 거부.
//  - 실패 행은 로깅 후 계속 진행(부분 성공 허용). 최상위로 예외를 던지지 않는다.
//  - 상단 배너로 DRY-RUN vs APPLY 모드를 명확히 표시한다.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import * as cheerio from 'cheerio'
// node 24 타입 스트리핑으로 .ts 유틸을 직접 import한다.
// (MODULE_TYPELESS_PACKAGE_JSON 경고는 표시상 무해 — 무시)
import { annotateImageDimensions } from '../../src/utils/imageDimensions.ts'

const APPLY = process.argv.includes('--apply')
const PAGE_SIZE = 200
const TABLES = ['posts', 'board_minutes']

// --- .env.local 로드 (기존 스크립트 관용구) ---
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey || url.includes('54321')) {
  console.error('운영 URL/서비스 키 확인 필요 (로컬 54321은 거부)')
  process.exit(1)
}
// CRITICAL: 유틸의 isSupabaseImageUrl은 process.env.NEXT_PUBLIC_SUPABASE_URL을 읽는다.
// 로컬 파싱 객체만으로는 origin 매칭이 전부 실패해(→ 0건 주입) 백필이 무의미해진다.
// 따라서 반드시 process.env에도 주입한다.
process.env.NEXT_PUBLIC_SUPABASE_URL = url

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// --- helpers ---

// width 속성이 있는 img 개수(=크기가 이미 있는 이미지 수).
function countSizedImgs(html) {
  try {
    const $ = cheerio.load(html, null, false)
    return $('img')
      .toArray()
      .filter(el => $(el).attr('width') != null).length
  } catch {
    return 0
  }
}

// 정규화 진단용: 속성을 하나도 추가하지 않고 cheerio 로드→직렬화만 수행한 기준선.
// 유틸이 내부에서 쓰는 것과 동일한 로드 방식(cheerio.load(content, null, false) + $.html()).
// 이 기준선이 원본과 다르면, 크기 주입과 무관하게 cheerio 재직렬화만으로도
// 바이트가 바뀐다는 뜻(예: &quot;→", 자기닫힘 정규화 등).
function roundTripBaseline(html) {
  try {
    const $ = cheerio.load(html, null, false)
    return $.html()
  } catch {
    return html
  }
}

// 두 문자열의 첫 diff 지점 주변을 잘라 보여준다(샘플 출력용, 개행은 ⏎로 치환).
function firstDiffSnippet(a, b, ctx = 70) {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  if (i === n && a.length === b.length) return null
  const start = Math.max(0, i - ctx)
  const slice = s => {
    const end = Math.min(s.length, i + ctx)
    return (
      (start > 0 ? '…' : '') + s.slice(start, end).replace(/\n/g, '⏎') + (end < s.length ? '…' : '')
    )
  }
  return { a: slice(a), b: slice(b) }
}

// --- 배너 ---
console.log('='.repeat(64))
console.log(
  APPLY
    ? '  APPLY (writing) — 변경분 content 컬럼을 DB에 씁니다'
    : '  DRY-RUN (no writes) — DB에 아무것도 쓰지 않습니다'
)
console.log(`  target: ${new URL(url).host}`)
console.log(`  tables: ${TABLES.join(', ')} (content_format='html')`)
console.log('='.repeat(64))

const grand = {
  scanned: 0,
  changed: 0,
  imgs: 0,
  normalized: 0,
  normalizedChanged: 0,
  updated: 0,
  failed: 0,
}
// 어느 한 테이블이라도 스캔이 중간에 끊겼는지(집계 신뢰 불가 여부).
let anyScanIncomplete = false

for (const table of TABLES) {
  console.log(`\n### table: ${table}`)
  let from = 0
  const t = {
    scanned: 0,
    changed: 0,
    imgs: 0,
    normalized: 0,
    normalizedChanged: 0,
    updated: 0,
    failed: 0,
  }
  // 페이지 조회(range) 자체가 실패하면 스캔이 중간에 끊긴다. 이때 이 테이블의
  // 집계(스캔/변경/이미지/정규화 수치)는 전부 과소집계이므로, row-level 실패
  // (t.failed)와는 별개로 "스캔 미완료" 플래그로 명확히 구분해 표시한다.
  let scanIncomplete = false
  let scanFailedAt = -1
  const changeSamples = []
  const normSamples = []

  for (;;) {
    const { data, error } = await db
      .from(table)
      .select('id, content')
      .eq('content_format', 'html')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(`  [${table}] 조회 실패 @range(${from}):`, error.message)
      scanIncomplete = true
      scanFailedAt = from
      anyScanIncomplete = true
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      t.scanned++
      try {
        const content = row.content
        if (typeof content !== 'string' || content.length === 0) continue

        // 정규화 진단: 속성 추가 없는 round-trip 기준선과 원본 비교.
        const baseline = roundTripBaseline(content)
        const hasNormDelta = baseline !== content
        if (hasNormDelta) {
          t.normalized++
          if (normSamples.length < 3) {
            const d = firstDiffSnippet(content, baseline)
            if (d) normSamples.push({ id: row.id, orig: d.a, base: d.b })
          }
        }

        // 실제 백필 대상 판정.
        const annotated = await annotateImageDimensions(content)
        if (annotated !== content) {
          t.changed++
          const gained = countSizedImgs(annotated) - countSizedImgs(content)
          t.imgs += Math.max(0, gained)
          // 실제로 DB에 써질 행 중 정규화 델타를 함께 실어보내는 행 수(진짜 blast radius).
          if (hasNormDelta) t.normalizedChanged++
          if (changeSamples.length < 3) {
            const d = firstDiffSnippet(content, annotated)
            if (d) changeSamples.push({ id: row.id, gained, before: d.a, after: d.b })
          }
          if (APPLY) {
            const { error: upErr } = await db
              .from(table)
              .update({ content: annotated })
              .eq('id', row.id)
            if (upErr) {
              t.failed++
              console.error(`  [${table}#${row.id}] update 실패:`, upErr.message)
            } else {
              t.updated++
            }
          }
        }
      } catch (e) {
        // 한 행이 실패해도 전체 실행을 중단하지 않는다.
        t.failed++
        console.error(`  [${table}#${row?.id}] 처리 실패:`, e?.message || e)
      }
    }

    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  console.log(`  - html 행 스캔: ${t.scanned}`)
  console.log(`  - 변경될 행: ${t.changed}`)
  console.log(`  - 크기 주입될 이미지 수: ${t.imgs}`)
  console.log(
    `  - 정규화 부작용 행(round-trip 기준선 ≠ 원본): ${t.normalized}` +
      ` (그중 실제 써질 변경 행: ${t.normalizedChanged})`
  )
  // row-level 실패(개별 행 처리 또는 update 오류)만 t.failed에 집계된다.
  if (APPLY) console.log(`  - updated: ${t.updated}, 행 실패(처리/update): ${t.failed}`)
  else if (t.failed) console.log(`  - 행 실패(처리 오류): ${t.failed}`)
  // 스캔 자체가 끊겼으면(=조회 실패) 위 수치가 전부 불완전함을 눈에 띄게 경고한다.
  if (scanIncomplete) {
    console.log(
      `  ⚠ 스캔 미완료 — range(${scanFailedAt})에서 조회 실패로 중단됨.` +
        ` 이 테이블 수치(스캔/변경/이미지/정규화)는 불완전(신뢰 불가).`
    )
  }

  if (normSamples.length) {
    console.log(`  · 정규화 델타 샘플(속성 추가 없이 재직렬화만 했을 때의 차이):`)
    for (const s of normSamples) {
      console.log(`    [#${s.id}] orig: ${s.orig}`)
      console.log(`    [#${s.id}] base: ${s.base}`)
    }
  }
  if (changeSamples.length) {
    console.log(`  · 변경(크기 주입) 샘플:`)
    for (const s of changeSamples) {
      console.log(`    [#${s.id}] +${s.gained} img`)
      console.log(`      before: ${s.before}`)
      console.log(`      after : ${s.after}`)
    }
  }

  grand.scanned += t.scanned
  grand.changed += t.changed
  grand.imgs += t.imgs
  grand.normalized += t.normalized
  grand.normalizedChanged += t.normalizedChanged
  grand.updated += t.updated
  grand.failed += t.failed
}

console.log(`\n${'='.repeat(64)}`)
console.log(
  `총계 — 스캔:${grand.scanned} 변경:${grand.changed} 이미지:${grand.imgs} ` +
    `정규화부작용:${grand.normalized}(써질행중:${grand.normalizedChanged})` +
    (APPLY ? ` updated:${grand.updated} 행실패:${grand.failed}` : '')
)
if (anyScanIncomplete) {
  console.log(
    '⚠ 스캔 미완료 테이블이 있음 — 위 총계는 불완전(신뢰 불가).' +
      ' 조회 실패를 해결하고 재실행할 것. (Task 4 승인 근거로 쓰지 말 것)'
  )
}
console.log(APPLY ? '완료(APPLY).' : '완료(DRY-RUN, 쓰기 없음). 검토 후 --apply로 실제 적용.')
console.log('='.repeat(64))

// 스캔이 하나라도 미완료면 수치가 권위 있지 않음을 종료코드로도 드러낸다.
if (anyScanIncomplete) process.exitCode = 1
