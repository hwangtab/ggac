import { test } from 'node:test'
import assert from 'node:assert/strict'

// 테스트는 우리 Supabase origin을 알아야 isSupabaseImageUrl이 매칭된다
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
const { annotateImageDimensions } = await import('../../src/utils/imageDimensions.ts')

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
