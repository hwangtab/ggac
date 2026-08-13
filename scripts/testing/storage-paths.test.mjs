import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://btugywkltavbogdnhwpu.supabase.co'
process.env.BLOB_PUBLIC_BASE_URL = 'https://examplestore.public.blob.vercel-storage.com'

const {
  currentProvider,
  splitBucketPath,
  logicalPathFromUrl,
  classifyDeleteEverywhereResults,
  isBlobPublicUrl,
  resolveOverwrite,
  buildVariantPathSuffixes,
} = await import('../../src/lib/storage/paths.ts')

const BLOB_BASE = 'https://examplestore.public.blob.vercel-storage.com'

function fulfilled(provider) {
  return { provider, result: { status: 'fulfilled', value: undefined } }
}

function rejected(provider, reason) {
  return { provider, result: { status: 'rejected', reason } }
}

test('STORAGE_PROVIDER 미설정이면 supabase', () => {
  delete process.env.STORAGE_PROVIDER
  assert.equal(currentProvider(), 'supabase')
})

test('blob일 때만 blob, 알 수 없는 값은 supabase', () => {
  process.env.STORAGE_PROVIDER = 'blob'
  assert.equal(currentProvider(), 'blob')
  process.env.STORAGE_PROVIDER = 'r2'
  assert.equal(currentProvider(), 'supabase')
  delete process.env.STORAGE_PROVIDER
})

test('논리 경로를 버킷과 키로 나눈다', () => {
  assert.deepEqual(splitBucketPath('attachments/2026/a.webp'), {
    bucket: 'attachments',
    key: '2026/a.webp',
  })
  assert.deepEqual(splitBucketPath('attachments/attachments/nested.webp'), {
    bucket: 'attachments',
    key: 'attachments/nested.webp',
  })
})

test('잘못된 경로를 거부한다', () => {
  for (const bad of ['', 'attachments', 'attachments/', '/attachments/a', 'a//b', 'x/../y']) {
    assert.throws(() => splitBucketPath(bad), /pathname/, `허용되면 안 됨: ${bad}`)
  }
})

test('Supabase URL에서 논리 경로를 복원한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://btugywkltavbogdnhwpu.supabase.co/storage/v1/object/public/attachments/posts/p1/a.webp',
      'attachments',
      'posts/p1'
    ),
    'attachments/posts/p1/a.webp'
  )
})

test('Blob URL에서 논리 경로를 복원한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://examplestore.public.blob.vercel-storage.com/attachments/posts/p1/a.webp',
      'attachments',
      'posts/p1'
    ),
    'attachments/posts/p1/a.webp'
  )
})

test('버킷이 다르면 거부한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://examplestore.public.blob.vercel-storage.com/artists/artist-001/p.webp',
      'attachments'
    ),
    null
  )
})

test('접두사가 다르면 거부한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://examplestore.public.blob.vercel-storage.com/attachments/posts/OTHER/a.webp',
      'attachments',
      'posts/p1'
    ),
    null
  )
})

test('알 수 없는 호스트는 거부한다', () => {
  assert.equal(
    logicalPathFromUrl('https://evil.example.com/attachments/a.webp', 'attachments'),
    null
  )
  assert.equal(logicalPathFromUrl('', 'attachments'), null)
})

test('everywhere 삭제: 리젝트가 없으면 로그도 throw도 없다', () => {
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    fulfilled('blob'),
    fulfilled('supabase'),
  ])
  assert.deepEqual(toLog, [])
  assert.equal(shouldThrow, false)
})

test('everywhere 삭제: 한쪽만 실패하면 로그에는 남지만 throw하지 않는다', () => {
  const reason = new Error('network timeout')
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    rejected('blob', reason),
    fulfilled('supabase'),
  ])
  assert.deepEqual(toLog, [{ provider: 'blob', reason }])
  assert.equal(shouldThrow, false)
})

test('everywhere 삭제: 둘 다 실패하면 둘 다 로그되고 throw한다', () => {
  const blobReason = new Error('unauthorized')
  const supabaseReason = new Error('network error')
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    rejected('blob', blobReason),
    rejected('supabase', supabaseReason),
  ])
  assert.deepEqual(toLog, [
    { provider: 'blob', reason: blobReason },
    { provider: 'supabase', reason: supabaseReason },
  ])
  assert.equal(shouldThrow, true)
})

test('Blob 공개 URL을 인식한다', () => {
  assert.equal(isBlobPublicUrl(`${BLOB_BASE}/artists/a.webp`), true)
  assert.equal(isBlobPublicUrl(`${BLOB_BASE}/attachments/posts/p1/a.webp`), true)
})

test('Blob 판정: 접미사 위조·다른 호스트·상대 경로·빈 문자열을 거부한다', () => {
  assert.equal(isBlobPublicUrl(`${BLOB_BASE}.evil.com/a`), false)
  assert.equal(isBlobPublicUrl('https://evil.com/a'), false)
  assert.equal(isBlobPublicUrl('artists/a.webp'), false)
  assert.equal(isBlobPublicUrl(''), false)
})

test('Blob 판정: BLOB_PUBLIC_BASE_URL이 없으면 항상 false다', () => {
  const saved = process.env.BLOB_PUBLIC_BASE_URL
  delete process.env.BLOB_PUBLIC_BASE_URL
  assert.equal(isBlobPublicUrl(`${BLOB_BASE}/artists/a.webp`), false)
  process.env.BLOB_PUBLIC_BASE_URL = saved
})

test('resolveOverwrite: opts가 없으면 false — 덮어쓰기 금지가 기본이다', () => {
  assert.equal(resolveOverwrite(), false)
  assert.equal(resolveOverwrite(undefined), false)
  assert.equal(resolveOverwrite({}), false)
})

test('resolveOverwrite: overwrite가 명시적으로 true일 때만 true를 돌려준다', () => {
  assert.equal(resolveOverwrite({ overwrite: true }), true)
  assert.equal(resolveOverwrite({ overwrite: false }), false)
})

test('resolveOverwrite: true가 아닌 값은 전부 false로 취급한다 (엄격한 === true 비교)', () => {
  // 회귀 방지: ?? 대신 === true를 쓴 이유 — truthy/falsy 강제 변환에 기대지 않고
  // "명시적으로 true"만 덮어쓰기를 허용한다는 걸 타입 실수로부터도 지킨다.
  assert.equal(resolveOverwrite({ overwrite: undefined }), false)
  assert.equal(resolveOverwrite({ overwrite: 1 }), false)
})

test('buildVariantPathSuffixes: 입력이 .webp면 originalPath와 webpPath가 같은 문자열이다 (구조적 성질, 회귀 고정)', () => {
  // media/upload와 mypage/artist/photo 둘 다 이 함수로 세 경로를 조립한다.
  // 원본 파일명이 이미 .webp로 끝나면 webp 변형 경로가 원본 경로와 정확히
  // 겹친다 — 그래서 두 라우트의 webp 변형 업로드는 putPublicObject(...,
  // { overwrite: true })를 명시적으로 써야 한다(원본 업로드가 먼저 그
  // 경로를 차지하므로). 이 테스트는 그 전제 자체를 고정한다 — 나중에
  // 명명 규칙이 바뀌어 이 성질이 사라지거나(=overwrite:true가 불필요해지거나)
  // 다른 곳에서도 겹치게 되면 여기서 드러나야 한다.
  const suffixes = buildVariantPathSuffixes(
    'artist-001',
    'profile_1755000000000_ab12.webp',
    'profile_1755000000000_ab12'
  )
  assert.equal(suffixes.originalPath, 'artist-001/profile_1755000000000_ab12.webp')
  assert.equal(suffixes.webpPath, 'artist-001/profile_1755000000000_ab12.webp')
  assert.equal(suffixes.originalPath, suffixes.webpPath)
  // fallback 경로는 항상 별개다 — .fallback.jpg 접미사가 붙으므로.
  assert.notEqual(suffixes.fallbackPath, suffixes.originalPath)
})

test('buildVariantPathSuffixes: jpg/png/jpeg 입력은 원본·webp·폴백 세 경로가 전부 다르다', () => {
  for (const [originalFileName, ext] of [
    ['profile_1755000000000_ab12.jpg', 'jpg'],
    ['profile_1755000000000_ab12.png', 'png'],
    ['profile_1755000000000_ab12.jpeg', 'jpeg'],
  ]) {
    const nameWithoutExtension = 'profile_1755000000000_ab12'
    const suffixes = buildVariantPathSuffixes('artist-001', originalFileName, nameWithoutExtension)
    assert.notEqual(suffixes.originalPath, suffixes.webpPath, `충돌하면 안 됨: ${ext}`)
    assert.notEqual(suffixes.originalPath, suffixes.fallbackPath, `충돌하면 안 됨: ${ext}`)
    assert.notEqual(suffixes.webpPath, suffixes.fallbackPath, `충돌하면 안 됨: ${ext}`)
  }
})

test('buildVariantPathSuffixes: media/upload 호출 패턴을 그대로 재현해도 .webp 입력은 충돌한다', () => {
  // generateStoragePaths(media/upload/route.ts)가 실제로 넘기는 인자 형태를
  // 그대로 재현한다 — basePrefix, safeFileName(확장자 포함), nameWithoutExtension.
  const basePrefix = 'attachments/user-123'
  const safeFileName = 'user-123_1755000000000_ab12_photo.webp'
  const nameWithoutExtension = 'user-123_1755000000000_ab12_photo'
  const suffixes = buildVariantPathSuffixes(basePrefix, safeFileName, nameWithoutExtension)
  assert.equal(suffixes.originalPath, suffixes.webpPath)
})

test('경로 형태 통일: logicalPathFromUrl 결과는 버킷 상대 경로에 버킷 접두사를 붙인 것과 문자열이 같다', () => {
  // mypage/artist/photo route.ts가 기대는 불변식: collectSafeArtistVariantPaths가
  // 돌려주는 버킷 상대 경로(`<artistId>/xxx.webp`)에 `artists/`를 붙인 문자열이,
  // profile_photo_url을 logicalPathFromUrl로 되돌린 논리 경로와 정확히 같은
  // 모양이어야 한다 — 두 형태를 한 Set에 안전하게 섞을 수 있는 근거.
  const bucketRelative = 'artist-001/profile_1755000000000_ab12.webp'
  const url = `https://btugywkltavbogdnhwpu.supabase.co/storage/v1/object/public/artists/${bucketRelative}`
  const logical = logicalPathFromUrl(url, 'artists', 'artist-001')
  assert.equal(logical, `artists/${bucketRelative}`)
})

test('중복 경로 제거: .webp 업로드로 원본·webp 변형 경로가 같은 문자열이 되면 Set이 하나로 합친다', () => {
  // Task 4에서 확인된 성질(buildVariantPathSuffixes) 그대로 재현 — .webp 입력이면
  // originalPath === webpPath다. 롤백/삭제 대상 목록을 만들 때 Set으로 담아야
  // 같은 객체를 두 번 세거나 두 번 지우려 하지 않는다.
  const suffixes = buildVariantPathSuffixes(
    'artist-001',
    'profile_1755000000000_ab12.webp',
    'profile_1755000000000_ab12'
  )
  const toRemove = Array.from(
    new Set([suffixes.originalPath, suffixes.webpPath, suffixes.fallbackPath].filter(Boolean))
  )
  assert.deepEqual(toRemove, [suffixes.originalPath, suffixes.fallbackPath])
  assert.equal(toRemove.length, 2)
})

test('everywhere 삭제: "does not exist" 메시지도 진짜 실패로 친다 (회귀 테스트)', () => {
  // BlobStoreNotFoundError의 실제 메시지. 예전 정규식(/not.?found|does not exist/i)은
  // 이 문자열을 "없는 객체"로 오인해 조용히 삼켰다 — 잘못된 토큰/스토어 설정이라는
  // 진짜 실패였는데도. 메시지로 거르지 않는 지금은 둘 다 실패로 잡혀 throw해야 한다.
  const blobReason = new Error('This store does not exist.')
  const supabaseReason = new Error('network error')
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    rejected('blob', blobReason),
    rejected('supabase', supabaseReason),
  ])
  assert.deepEqual(toLog, [
    { provider: 'blob', reason: blobReason },
    { provider: 'supabase', reason: supabaseReason },
  ])
  assert.equal(shouldThrow, true)
})
