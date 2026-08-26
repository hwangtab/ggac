import { test } from 'node:test'
import assert from 'node:assert/strict'

const { toMediaListing, mimeTypeFromFileName, extensionOf } = await import(
  '../../src/lib/storage/mediaListing.ts'
)

// `GET /api/media/upload`의 목록 변환부. 단계 4 Task 5에서 Supabase Storage
// `list()` 응답을 Blob `list()` 응답으로 바꿔 끼우면서 새로 생긴 코드라,
// 화면 계약(MediaFile)이 그대로인지 여기서 고정한다.

const BUCKET = 'attachments'
const BASE = 'attachments/user-1'

function obj(name, overrides = {}) {
  return {
    pathname: `${BUCKET}/${BASE}/${name}`,
    url: `https://store.public.blob.vercel-storage.com/${BUCKET}/${BASE}/${name}`,
    size: 100,
    uploadedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

test('확장자로 MIME을 추정한다(Blob 목록에는 contentType이 없다)', () => {
  assert.equal(mimeTypeFromFileName('a.JPG'), 'image/jpeg')
  assert.equal(mimeTypeFromFileName('a.webp'), 'image/webp')
  assert.equal(mimeTypeFromFileName('a.pdf'), 'application/pdf')
  // 알 수 없는 확장자와 확장자 없는 이름은 예전 Supabase 경로가
  // metadata.mimetype이 비었을 때 쓰던 값으로 떨어진다.
  assert.equal(mimeTypeFromFileName('a.xyz'), 'application/octet-stream')
  assert.equal(mimeTypeFromFileName('noext'), 'application/octet-stream')
  // 숨김 파일은 앞의 점을 확장자로 보지 않는다.
  assert.equal(extensionOf('.gitignore'), '')
})

test('webp/폴백 변형은 목록에서 빠지고 원본의 variants로만 노출된다', () => {
  const entries = toMediaListing([obj('a.png'), obj('a.webp'), obj('a.fallback.jpg')], BUCKET, BASE)
  assert.equal(entries.length, 1)
  const [entry] = entries
  assert.equal(entry.name, 'a.png')
  assert.equal(entry.type, 'image/png')
  assert.deepEqual(entry.variants, {
    original: `${BASE}/a.png`,
    webp: `${BASE}/a.webp`,
    fallback: `${BASE}/a.fallback.jpg`,
  })
  // 화면은 webp를 우선한다(예전 동작 그대로).
  assert.equal(entry.path, `${BASE}/a.webp`)
  assert.match(entry.public_url, /a\.webp$/)
})

test('원본이 JPEG면 폴백 파일이 없어도 원본이 폴백 역할을 한다', () => {
  const [entry] = toMediaListing([obj('b.jpeg')], BUCKET, BASE)
  assert.equal(entry.variants.fallback, `${BASE}/b.jpeg`)
  assert.equal(entry.variants.webp, undefined)
  assert.equal(entry.path, `${BASE}/b.jpeg`)
})

test('원본이 JPEG가 아니고 변형도 없으면 폴백은 없다', () => {
  const [entry] = toMediaListing([obj('c.pdf')], BUCKET, BASE)
  assert.equal(entry.variants.fallback, undefined)
  assert.equal(entry.variants.webp, undefined)
  assert.equal(entry.type, 'application/pdf')
})

// 봉쇄. Blob `list()`는 접두사 아래를 **재귀적으로** 훑으므로, 예전 Supabase
// `list()`(한 단계만)와 같은 결과를 내려면 하위 경로를 직접 걸러야 한다.
// 걸러내지 않으면 다른 사용자의 파일이 섞이지는 않지만(접두사에 uid가 들어
// 있다) 목록에 `sub/deep.png` 같은 이름이 그대로 새어 나온다.
test('접두사 바로 아래 한 단계만 목록에 넣는다', () => {
  const entries = toMediaListing(
    [obj('top.png'), obj('sub/deep.png'), obj('sub/nested/deeper.png')],
    BUCKET,
    BASE
  )
  assert.deepEqual(
    entries.map(e => e.name),
    ['top.png']
  )
})

// 부정 대조: 다른 사용자 접두사의 객체가 응답에 섞이면 안 된다. 라우트가
// 접두사를 잘못 넘기는 회귀에서 이 필터가 마지막 방어선이다.
test('기준 접두사 밖의 객체는 통째로 제외된다', () => {
  const other = {
    pathname: `${BUCKET}/attachments/user-2/secret.png`,
    url: 'https://store.public.blob.vercel-storage.com/attachments/attachments/user-2/secret.png',
    size: 1,
    uploadedAt: new Date('2026-08-01T00:00:00.000Z'),
  }
  const wrongBucket = {
    pathname: `profiles/${BASE}/x.png`,
    url: 'https://store.public.blob.vercel-storage.com/profiles/attachments/user-1/x.png',
    size: 1,
    uploadedAt: new Date('2026-08-01T00:00:00.000Z'),
  }
  const entries = toMediaListing([obj('mine.png'), other, wrongBucket], BUCKET, BASE)
  assert.deepEqual(
    entries.map(e => e.name),
    ['mine.png']
  )
})

test('id는 목록 안에서 유일하다(변형이 빠져도 인덱스가 어긋나지 않는다)', () => {
  const entries = toMediaListing(
    [obj('a.png'), obj('a.webp'), obj('b.png'), obj('b.webp')],
    BUCKET,
    BASE
  )
  assert.deepEqual(
    entries.map(e => e.id),
    ['attachments-a.png-0', 'attachments-b.png-1']
  )
})

test('uploaded_at은 ISO 문자열로 나간다', () => {
  const [entry] = toMediaListing(
    [obj('a.png', { uploadedAt: new Date('2026-08-19T12:34:56.000Z') })],
    BUCKET,
    BASE
  )
  assert.equal(entry.uploaded_at, '2026-08-19T12:34:56.000Z')
})
