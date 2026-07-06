import { test } from 'node:test'
import assert from 'node:assert/strict'

// 테스트는 우리 Supabase origin을 알아야 isSupabaseImageUrl이 매칭된다
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
const { annotateImageDimensions, annotateImageDimensionsSafe } = await import(
  '../../src/utils/imageDimensions.ts'
)

const SB = 'https://proj.supabase.co/storage/v1/object/public/board/a.jpg'
// 주입 가능한 stub resolver로 fetch/sharp 없이 순수 변환 검증
const stub = async src => (src === SB ? { width: 800, height: 600 } : null)

test('크기 없는 Supabase 이미지에 width/height 주입', async () => {
  const html = `<p>t</p><img src="${SB}">`
  const out = await annotateImageDimensions(html, stub)
  assert.match(out, /width="800"/)
  assert.match(out, /height="600"/)
})

test('이미 크기 있는 이미지는 불변', async () => {
  const html = `<img src="${SB}" width="10" height="20">`
  const out = await annotateImageDimensions(html, stub)
  assert.match(out, /width="10"/)
  assert.match(out, /height="20"/)
  assert.doesNotMatch(out, /width="800"/)
})

test('외부 URL 이미지는 스킵', async () => {
  const html = `<img src="https://other.com/x.jpg">`
  const out = await annotateImageDimensions(html, stub)
  assert.doesNotMatch(out, /width=/)
})

test('resolve가 null이면 그 img 불변', async () => {
  const html = `<img src="https://proj.supabase.co/storage/v1/object/public/board/none.jpg">`
  const out = await annotateImageDimensions(html, async () => null)
  assert.doesNotMatch(out, /width=/)
})

test('본문 텍스트·구조는 보존(속성만 추가)', async () => {
  const html = `<p>안녕 <strong>세계</strong></p><img src="${SB}">`
  const out = await annotateImageDimensions(html, stub)
  assert.match(out, /<p>안녕 <strong>세계<\/strong><\/p>/)
})

test('img 없으면 원본 그대로', async () => {
  const html = `<p>no image</p>`
  assert.equal(await annotateImageDimensions(html, stub), html)
})

// --- 라운드트립 회귀(엔티티 보존) ---
test('필수 엔티티(&amp; &lt; &gt;)는 텍스트 노드에서 그대로 보존', async () => {
  const html = `<p>a &amp; b &lt;x&gt;</p><img src="${SB}">`
  const out = await annotateImageDimensions(html, stub)
  assert.match(out, /a &amp; b &lt;x&gt;/)
})

// pinned cheerio round-trip behavior — cosmetic, visually identical; see util NOTE.
// cheerio(parse5)는 텍스트 노드의 &quot;/&apos;를 리터럴 "/'로 직렬화한다.
// 렌더 결과는 동일(무해)하지만, 미래에 이 동작이 바뀌면 여기서 실패하도록 고정한다.
test('텍스트 노드의 &quot;/&apos;는 리터럴 따옴표로 정규화(고정된 동작)', async () => {
  const html = `<p>&quot;q&quot; &apos;a&apos;</p><img src="${SB}">`
  const out = await annotateImageDimensions(html, stub)
  assert.match(out, /<p>"q" 'a'<\/p>/)
  assert.doesNotMatch(out, /&quot;/)
  assert.doesNotMatch(out, /&apos;/)
})

// --- 동시성 배치 루프 커버리지 ---
test('한 호출의 여러 Supabase 이미지 모두 주입(배치 루프)', async () => {
  const n = 5
  const srcs = Array.from(
    { length: n },
    (_, i) => `https://proj.supabase.co/storage/v1/object/public/board/img${i}.jpg`
  )
  const many = async src =>
    srcs.includes(src) ? { width: 100 + srcs.indexOf(src), height: 200 } : null
  const html = srcs.map(s => `<p><img src="${s}"></p>`).join('')
  const out = await annotateImageDimensions(html, many)
  for (let i = 0; i < n; i++) {
    assert.ok(
      out.includes(`<img src="${srcs[i]}" width="${100 + i}" height="200">`),
      `img${i} annotated`
    )
  }
})

test('커스텀 concurrency(2)에서도 모든 이미지 주입', async () => {
  const n = 5
  const srcs = Array.from(
    { length: n },
    (_, i) => `https://proj.supabase.co/storage/v1/object/public/board/c${i}.jpg`
  )
  const many = async src => (srcs.includes(src) ? { width: 300, height: 400 } : null)
  const html = srcs.map(s => `<p><img src="${s}"></p>`).join('')
  const out = await annotateImageDimensions(html, many, { concurrency: 2 })
  for (const s of srcs) {
    assert.ok(out.includes(`<img src="${s}" width="300" height="400">`), `${s} annotated`)
  }
})

// --- resolver 하드닝 ---
test('resolver가 특정 src에서 throw해도 나머지는 주입되고 유틸은 throw 안 함', async () => {
  const A = 'https://proj.supabase.co/storage/v1/object/public/board/ok1.jpg'
  const BOOM = 'https://proj.supabase.co/storage/v1/object/public/board/boom.jpg'
  const C = 'https://proj.supabase.co/storage/v1/object/public/board/ok2.jpg'
  const throwing = async src => {
    if (src === BOOM) throw new Error('resolver blew up')
    return { width: 50, height: 60 }
  }
  const html = `<img src="${A}"><img src="${BOOM}"><img src="${C}">`
  const out = await annotateImageDimensions(html, throwing)
  assert.ok(out.includes(`<img src="${A}" width="50" height="60">`), 'A annotated')
  assert.ok(out.includes(`<img src="${C}" width="50" height="60">`), 'C annotated')
  // throw한 이미지는 크기 없이 그대로 남는다
  assert.ok(out.includes(`<img src="${BOOM}">`), 'BOOM left unsized')
})

// --- annotateImageDimensionsSafe: 저장 경로 단일 진입점(예산·무예외 계약) ---
// 래퍼 자체의 두 성질만 격리 검증한다: (1) 예산 초과·예외 시 원본 반환, (2) 절대 throw 안 함.
// 실 리졸버(fetch+sharp) 없이 검증하려고 테스트 전용 훅 `_annotate`를 주입한다.

test('Safe: 적격 이미지가 없으면 원본을 (실 리졸버 경로로) 그대로 빠르게 반환', async () => {
  const html = `<p>hi</p><img src="https://other.com/x.jpg">`
  const out = await annotateImageDimensionsSafe(html)
  assert.equal(out, html)
})

test('Safe: 깨진 html에도 throw하지 않고 문자열을 반환', async () => {
  const html = `<img src="<<<broken" <p>unclosed <<>`
  const out = await annotateImageDimensionsSafe(html)
  assert.equal(typeof out, 'string')
})

test('Safe: 예산(budgetMs) 초과 시 원본 반환(느린 annotate 주입)', async () => {
  const html = `<p>content</p><img src="${SB}">`
  const slow = () => new Promise(() => {}) // 절대 resolve 안 함
  const start = Date.now()
  const out = await annotateImageDimensionsSafe(html, { budgetMs: 30, _annotate: slow })
  assert.equal(out, html)
  assert.ok(Date.now() - start < 2000, '예산 안에서 반환(느린 annotate를 기다리지 않음)')
})

test('Safe: annotate가 reject해도 throw 없이 원본 반환', async () => {
  const html = `<p>x</p><img src="${SB}">`
  const boom = () => Promise.reject(new Error('boom'))
  const out = await annotateImageDimensionsSafe(html, { _annotate: boom })
  assert.equal(out, html)
})

test('Safe: 예산 내에 resolve되면 annotate 결과를 반환(happy path)', async () => {
  const html = `<img src="${SB}">`
  const fast = async h => h.replace('<img', '<img width="800" height="600"')
  const out = await annotateImageDimensionsSafe(html, { budgetMs: 5000, _annotate: fast })
  assert.match(out, /width="800"/)
  assert.match(out, /height="600"/)
})
