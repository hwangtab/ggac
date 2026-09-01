import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL = 'https://examplestore.public.blob.vercel-storage.com'

const {
  splitBucketPath,
  logicalPathFromUrl,
  isBlobPublicUrl,
  resolveOverwrite,
  buildVariantPathSuffixes,
} = await import('../../src/lib/storage/paths.ts')

const BLOB_BASE = 'https://examplestore.public.blob.vercel-storage.com'

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

// 2026-09-01 Supabase 프로젝트 삭제 후, 남은 Supabase 절대 URL이 0건임을
// 실측하고 logicalPathFromUrl에서 Supabase 형식 인식을 걷어냈다. 되살아나면
// 판정 근거가 없는 환경변수에 다시 매이므로, 거부하는지를 고정한다.
test('레거시 Supabase Storage URL은 더 이상 인식하지 않는다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://btugywkltavbogdnhwpu.supabase.co/storage/v1/object/public/attachments/posts/p1/a.webp',
      'attachments',
      'posts/p1'
    ),
    null
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

test('Blob 판정: NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL이 없으면 항상 false다', () => {
  const saved = process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL
  delete process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL
  assert.equal(isBlobPublicUrl(`${BLOB_BASE}/artists/a.webp`), false)
  process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL = saved
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
  const url = `${BLOB_BASE}/artists/${bucketRelative}`
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

test('마이페이지 사진 게이트는 legacy_id를 접두사로 받는다 — UUID를 넘기면 사진이 사라진다', () => {
  // 2026-09-01 적대 감사가 잡은 실제 회귀. `ProfileEditForm`이 `artistData?.id`
  // (UUID)를 `PersonalInfo`의 `artistId`로 넘기고 있었는데, 사진의 저장 경로
  // 접두사는 업로드 라우트가 쓰는 `member_profiles.artist_id`(= `artist-016` 꼴)다.
  //
  // 이 불일치는 **에러를 내지 않는다.** 게이트가 조용히 false가 되어 사진 자리가
  // 기본 아이콘으로 바뀔 뿐이라, 화면을 직접 보지 않으면 알 수 없다. 그래서
  // 여기에 못박는다.
  const url = `${BLOB_BASE}/artists/artist-016/profile_1778033706926.webp`

  assert.equal(
    logicalPathFromUrl(url, 'artists', 'artist-016'),
    'artists/artist-016/profile_1778033706926.webp',
    'legacy_id 접두사는 통과해야 한다'
  )
  assert.equal(
    logicalPathFromUrl(url, 'artists', 'e7dde30e-a826-40d8-8112-759f7cbdb8c8'),
    null,
    'UUID 접두사는 막힌다 — 이것이 회귀의 정체다'
  )
})

test('ProfileEditForm은 artistId로 legacy_id를 넘긴다 (UUID인 artists.id가 아니라)', async () => {
  // 위 테스트는 함수의 성질만 본다. 정작 회귀는 **호출부가 무엇을 넘기는가**에
  // 있었으므로, 호출부 자체를 못박는다.
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(
    new URL(
      '../../src/app/[locale]/mypage/profile/components/ProfileEditForm.tsx',
      import.meta.url
    ),
    'utf8'
  )
  assert.match(
    src,
    /artistId=\{artistData\?\.legacy_id\s*\|\|\s*null\}/,
    'artistId에는 legacy_id를 넘겨야 한다'
  )
  assert.doesNotMatch(
    src,
    /artistId=\{artistData\?\.id\s*\|\|\s*null\}/,
    'artists.id(UUID)를 넘기면 마이페이지 사진이 전원 사라진다'
  )
})
