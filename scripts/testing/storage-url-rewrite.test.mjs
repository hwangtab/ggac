import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  rewriteUrl,
  rewriteAllInText,
  conditionalUpdate,
  backupAll,
  resolveBackupDir,
  planArtistPhotoUpdate,
} = await import('../storage/rewrite-db-urls.mjs')
const { restoreFromBackup } = await import('../storage/restore-db-urls.mjs')

const BASE = 'https://examplestore.public.blob.vercel-storage.com'
const SUPA = 'https://btugywkltavbogdnhwpu.supabase.co/storage/v1/object/public'

// ---------------------------------------------------------------------------
// rewriteUrl / rewriteAllInText — brief 지정 테스트 (그대로)
// ---------------------------------------------------------------------------

test('Supabase 공개 URL을 Blob URL로 바꾼다', () => {
  assert.equal(rewriteUrl(`${SUPA}/artists/a-001/p.webp`, BASE), `${BASE}/artists/a-001/p.webp`)
})

test('대상이 아니면 원문 그대로', () => {
  assert.equal(rewriteUrl('/images/logo/gac_og.webp', BASE), '/images/logo/gac_og.webp')
  assert.equal(rewriteUrl('https://youtube.com/x', BASE), 'https://youtube.com/x')
  assert.equal(rewriteUrl('', BASE), '')
  assert.equal(rewriteUrl(null, BASE), null)
})

test('비공개 버킷(sign) URL은 건드리지 않는다', () => {
  const priv =
    'https://btugywkltavbogdnhwpu.supabase.co/storage/v1/object/sign/board-documents/x.pdf'
  assert.equal(rewriteUrl(priv, BASE), priv)
})

test('이미 Blob URL이면 그대로 (멱등)', () => {
  assert.equal(rewriteUrl(`${BASE}/artists/a.webp`, BASE), `${BASE}/artists/a.webp`)
})

test('본문 안의 여러 URL을 모두 바꾼다', () => {
  const html = `<img src="${SUPA}/attachments/a.webp"><p>글</p><img src="${SUPA}/attachments/b.png">`
  const out = rewriteAllInText(html, BASE)
  assert.equal(out.includes(`${BASE}/attachments/a.webp`), true)
  assert.equal(out.includes(`${BASE}/attachments/b.png`), true)
  assert.equal(out.includes('supabase.co'), false)
  assert.equal(out.includes('<p>글</p>'), true)
})

test('따옴표 없이 인접한 두 URL을 각각 바꾼다 (v1 회귀)', () => {
  const text = `${SUPA}/attachments/a.webp,${SUPA}/attachments/b.png`
  const out = rewriteAllInText(text, BASE)
  assert.equal(out, `${BASE}/attachments/a.webp,${BASE}/attachments/b.png`)
  assert.equal(out.includes('supabase.co'), false)
})

test('공백으로 이어진 두 URL도 각각 바꾼다', () => {
  const text = `${SUPA}/attachments/a.webp ${SUPA}/attachments/b.png`
  assert.equal(rewriteAllInText(text, BASE), `${BASE}/attachments/a.webp ${BASE}/attachments/b.png`)
})

test('마크다운 링크와 문장부호를 삼키지 않는다', () => {
  assert.equal(
    rewriteAllInText(`[사진](${SUPA}/attachments/a.webp)를 보라.`, BASE),
    `[사진](${BASE}/attachments/a.webp)를 보라.`
  )
})

test('대상이 없으면 원문 그대로', () => {
  const html = '<p>세미콜론; 포함 본문</p>'
  assert.equal(rewriteAllInText(html, BASE), html)
})

// ---------------------------------------------------------------------------
// 추가: 멱등성 — 두 번 실행해도 안전한지 (rewriteAllInText 쪽도 확인)
// ---------------------------------------------------------------------------

test('rewriteAllInText도 두 번 실행하면 결과가 그대로다 (멱등)', () => {
  const html = `<img src="${SUPA}/attachments/a.webp"><p>글</p><img src="${SUPA}/attachments/b.png">`
  const once = rewriteAllInText(html, BASE)
  const twice = rewriteAllInText(once, BASE)
  assert.equal(once, twice)
  assert.equal(twice.includes('supabase.co'), false)
})

// ---------------------------------------------------------------------------
// 추가: profile_photo_metadata의 null/JSON 왕복 안전성
// ---------------------------------------------------------------------------

test('metadata가 null이어도 JSON.stringify → rewrite → JSON.parse 왕복이 안전하다', () => {
  const original = null
  const metaJson = rewriteAllInText(JSON.stringify(original ?? {}), BASE)
  const meta = JSON.parse(metaJson)
  assert.deepEqual(meta, {})
})

test('metadata가 undefined/부재여도 왕복이 안전하다', () => {
  const row = {}
  const metaJson = rewriteAllInText(JSON.stringify(row.profile_photo_metadata ?? {}), BASE)
  assert.deepEqual(JSON.parse(metaJson), {})
})

test('metadata 안의 URL은 바뀌고 나머지 필드는 그대로 보존된다', () => {
  const original = { source: `${SUPA}/artists/a/orig.webp`, width: 800 }
  const metaJson = rewriteAllInText(JSON.stringify(original), BASE)
  const meta = JSON.parse(metaJson)
  assert.equal(meta.source, `${BASE}/artists/a/orig.webp`)
  assert.equal(meta.width, 800)
})

// ---------------------------------------------------------------------------
// conditionalUpdate — 데이터 유실 가드의 핵심 로직을 가짜 Supabase로 검증
// ---------------------------------------------------------------------------

/**
 * 저장된 값과 필터 값이 매치하는지 판단한다. jsonb 컬럼(profile_photo_metadata)은
 * 실제 저장소에 JS 객체로 들어있고, conditionalUpdate가 보내는 필터 값은
 * JSON.stringify된 문자열이다 — 실제 프로덕션에서 PostgREST가 그 문자열을
 * jsonb로 캐스팅해 구조적으로 비교하는 것과 같은 결과가 나오도록
 * JSON.stringify로 맞춰 비교한다(실제 동작은 scripts/storage/rewrite-db-urls.mjs의
 * conditionalUpdate 주석에 적은 프로덕션 검증 참고).
 */
function valuesMatch(stored, filterVal) {
  if (filterVal === null) return stored === null || stored === undefined
  if (stored !== null && typeof stored === 'object') return JSON.stringify(stored) === filterVal
  return stored === filterVal
}

/** rows를 직접 변형하는(mutate) 가짜 Supabase. eq/is 모두 값 일치로 필터링한다. */
function makeFakeSupabase(rows) {
  return {
    from() {
      return {
        update(patch) {
          const filters = []
          const chain = {
            eq(col, val) {
              filters.push([col, val])
              return chain
            },
            is(col, val) {
              filters.push([col, val])
              return chain
            },
            select() {
              const matched = rows.filter(r =>
                filters.every(([col, val]) => valuesMatch(r[col], val))
              )
              for (const r of matched) Object.assign(r, patch)
              return Promise.resolve({ data: matched.map(r => ({ id: r.id })), error: null })
            },
          }
          return chain
        },
      }
    },
  }
}

function makeErrorSupabase(message) {
  const chain = {
    eq() {
      return chain
    },
    is() {
      return chain
    },
    select() {
      return Promise.resolve({ data: null, error: { message } })
    },
  }
  return { from: () => ({ update: () => chain }) }
}

test('conditionalUpdate: 읽은 값과 같으면 갱신하고 changed를 반환', async () => {
  const rows = [{ id: 1, profile_photo_url: 'old' }]
  const s = makeFakeSupabase(rows)
  const r = await conditionalUpdate(
    s,
    'artists',
    1,
    { profile_photo_url: 'new' },
    { profile_photo_url: 'old' }
  )
  assert.equal(r.status, 'changed')
  assert.equal(rows[0].profile_photo_url, 'new')
})

test('conditionalUpdate: 그 사이 값이 바뀌었으면 건너뛰고 새 값을 보존한다 (데이터 유실 가드)', async () => {
  // SELECT 이후 조합원이 새 사진으로 이미 바꿔놓은 상태를 시뮬레이션
  const rows = [{ id: 1, profile_photo_url: 'brand-new-photo-uploaded-by-member' }]
  const s = makeFakeSupabase(rows)
  const r = await conditionalUpdate(
    s,
    'artists',
    1,
    { profile_photo_url: 'stale-rewritten-pointer' },
    { profile_photo_url: 'old' } // rewrite가 읽었던 낡은 값
  )
  assert.equal(r.status, 'skipped')
  // 새 사진 값이 절대 덮어써지지 않아야 한다
  assert.equal(rows[0].profile_photo_url, 'brand-new-photo-uploaded-by-member')
})

test('conditionalUpdate: 읽은 값이 null이면 is()로 매칭한다', async () => {
  const rows = [{ id: 1, profile_photo_url: null }]
  const s = makeFakeSupabase(rows)
  const r = await conditionalUpdate(
    s,
    'artists',
    1,
    { profile_photo_url: 'new' },
    { profile_photo_url: null }
  )
  assert.equal(r.status, 'changed')
  assert.equal(rows[0].profile_photo_url, 'new')
})

test('conditionalUpdate: null이 아니었는데 그 사이 null로 바뀌었으면 건너뛴다', async () => {
  const rows = [{ id: 1, profile_photo_url: null }]
  const s = makeFakeSupabase(rows)
  const r = await conditionalUpdate(
    s,
    'artists',
    1,
    { profile_photo_url: 'new' },
    { profile_photo_url: 'old' } // 읽었을 땐 old였는데 지금은 null
  )
  assert.equal(r.status, 'skipped')
  assert.equal(rows[0].profile_photo_url, null)
})

test('conditionalUpdate: Supabase 에러는 상태로 전달되고 조용히 삼켜지지 않는다', async () => {
  const s = makeErrorSupabase('permission denied')
  const r = await conditionalUpdate(
    s,
    'artists',
    1,
    { profile_photo_url: 'new' },
    { profile_photo_url: 'old' }
  )
  assert.equal(r.status, 'error')
  assert.equal(r.message, 'permission denied')
})

// ---------------------------------------------------------------------------
// planArtistPhotoUpdate — artists 행의 url·metadata 갱신 계획 (순수 함수)
// 코디네이터 리뷰 Finding 1: 원래 previous 가드가 profile_photo_url만 담고
// profile_photo_metadata는 빠져 있어서, url은 안 바뀌고 metadata만 다른 요청이
// 먼저 바꾼 경우 그 새 metadata를 감지 못하고 재작성이 덮어썼다.
// ---------------------------------------------------------------------------

test('planArtistPhotoUpdate: url만 바뀌면 patch·previous 둘 다 url만 반영, metadata는 그대로 보존', () => {
  const row = {
    id: 'a1',
    profile_photo_url: `${SUPA}/artists/a1/p.webp`,
    profile_photo_metadata: null,
  }
  const plan = planArtistPhotoUpdate(row, BASE)
  assert.notEqual(plan, null)
  assert.equal(plan.patch.profile_photo_url, `${BASE}/artists/a1/p.webp`)
  // null이었던 metadata가 {}로 바뀌어 쓰이면 안 된다 — 손대지 않은 컬럼을
  // 조용히 덮어쓰는 부수효과 방지
  assert.equal(plan.patch.profile_photo_metadata, null)
  assert.equal(plan.previous.profile_photo_url, row.profile_photo_url)
  assert.equal(plan.previous.profile_photo_metadata, null)
})

test('planArtistPhotoUpdate: metadata 안의 URL만 바뀌어도 감지하고 두 컬럼 다 가드에 담는다', () => {
  const row = {
    id: 'a1',
    profile_photo_url: '/images/logo/gac_og.webp', // 재작성 대상 아님, 안 바뀜
    profile_photo_metadata: { source: `${SUPA}/artists/a1/orig.webp`, width: 800 },
  }
  const plan = planArtistPhotoUpdate(row, BASE)
  assert.notEqual(plan, null)
  assert.equal(plan.patch.profile_photo_url, row.profile_photo_url) // 변경 없음
  assert.equal(plan.patch.profile_photo_metadata.source, `${BASE}/artists/a1/orig.webp`)
  assert.equal(plan.patch.profile_photo_metadata.width, 800)
  // previous 가드는 원래 값을 JSON 문자열로 담는다 — 컬럼 두 개 다
  assert.equal(plan.previous.profile_photo_url, row.profile_photo_url)
  assert.equal(plan.previous.profile_photo_metadata, JSON.stringify(row.profile_photo_metadata))
})

test('planArtistPhotoUpdate: 둘 다 안 바뀌면 null(갱신 불필요)', () => {
  const row = {
    id: 'a1',
    profile_photo_url: '/images/logo/gac_og.webp',
    profile_photo_metadata: { note: '재작성 대상 URL 없음' },
  }
  assert.equal(planArtistPhotoUpdate(row, BASE), null)
})

test('planArtistPhotoUpdate: metadata가 undefined여도 null과 동일하게 다룬다', () => {
  const row = { id: 'a1', profile_photo_url: `${SUPA}/artists/a1/p.webp` } // metadata 필드 자체가 없음
  const plan = planArtistPhotoUpdate(row, BASE)
  assert.notEqual(plan, null)
  assert.equal(plan.patch.profile_photo_metadata, null)
  assert.equal(plan.previous.profile_photo_metadata, null)
})

test('planArtistPhotoUpdate + conditionalUpdate: metadata가 그 사이 다른 요청으로 바뀌면 건너뛰고 새 metadata를 보존한다 (Finding 1 회귀)', async () => {
  // src/app/api/mypage/artist/route.ts처럼 url은 그대로 두고 metadata만 새로
  // 바꾸는 요청이 SELECT 직후, UPDATE 직전에 끼어든 상황을 재현한다.
  const originalRow = {
    id: 'a1',
    profile_photo_url: '/images/logo/gac_og.webp', // 재작성 대상 아님, 안 바뀜
    profile_photo_metadata: { source: `${SUPA}/artists/a1/orig.webp`, width: 800 },
  }
  // rewrite-db-urls.mjs가 SELECT에서 읽은 시점의 스냅샷
  const plan = planArtistPhotoUpdate(originalRow, BASE)
  assert.notEqual(plan, null) // metadata 안 URL이 바뀌어야 하므로 갱신 계획이 나온다

  // 그 사이 다른 요청이 이 행의 metadata를 완전히 다른 새 값으로 이미 바꿔놓았다
  // (url 컬럼은 안 건드림 — Zod 스키마에서 profile_photo_url이 optional이라
  // 가능한 시나리오)
  const freshMetadata = { source: `${SUPA}/artists/a1/brand-new-upload.webp`, width: 1200 }
  const rows = [
    {
      id: 'a1',
      profile_photo_url: originalRow.profile_photo_url,
      profile_photo_metadata: freshMetadata,
    },
  ]
  const s = makeFakeSupabase(rows)

  const result = await conditionalUpdate(s, 'artists', 'a1', plan.patch, plan.previous)

  assert.equal(result.status, 'skipped')
  // 핵심 단언: 다른 요청이 쓴 새 metadata가 재작성의 낡은 값으로 덮이지 않았다
  assert.deepEqual(rows[0].profile_photo_metadata, freshMetadata)
})

test('planArtistPhotoUpdate + conditionalUpdate: 아무것도 안 바뀌었으면 정상적으로 갱신된다 (정상 경로)', async () => {
  const originalRow = {
    id: 'a1',
    profile_photo_url: '/images/logo/gac_og.webp',
    profile_photo_metadata: { source: `${SUPA}/artists/a1/orig.webp`, width: 800 },
  }
  const plan = planArtistPhotoUpdate(originalRow, BASE)
  assert.notEqual(plan, null)

  // DB 상태가 SELECT 시점과 정확히 같다 (경합 없음)
  const rows = [
    {
      id: 'a1',
      profile_photo_url: originalRow.profile_photo_url,
      profile_photo_metadata: originalRow.profile_photo_metadata,
    },
  ]
  const s = makeFakeSupabase(rows)

  const result = await conditionalUpdate(s, 'artists', 'a1', plan.patch, plan.previous)

  assert.equal(result.status, 'changed')
  assert.equal(rows[0].profile_photo_metadata.source, `${BASE}/artists/a1/orig.webp`)
})

// ---------------------------------------------------------------------------
// backupAll — 백업이 실제로 파일에 쓰이는지, 그리고 재실행이 이전 백업을
// 덮어쓰지 않는지 (코디네이터 리뷰 Finding 2)
// ---------------------------------------------------------------------------

function makeReadSupabase(tables) {
  return {
    from(name) {
      return {
        select() {
          return Promise.resolve({ data: tables[name] ?? [], error: null })
        },
      }
    },
  }
}

test('resolveBackupDir: 베이스 디렉터리 아래 타임스탬프 하위 디렉터리 경로를 만든다', () => {
  const now = new Date('2026-08-13T10:15:30.123Z')
  assert.equal(resolveBackupDir('/tmp/backups', now), '/tmp/backups/2026-08-13T10-15-30-123Z')
})

test('resolveBackupDir: 베이스 디렉터리 끝의 슬래시는 중복되지 않는다', () => {
  const now = new Date('2026-08-13T10:15:30.123Z')
  assert.equal(resolveBackupDir('/tmp/backups/', now), '/tmp/backups/2026-08-13T10-15-30-123Z')
})

test('resolveBackupDir: 시각이 다르면 경로도 달라진다 (재실행마다 새 경로)', () => {
  const a = resolveBackupDir('/tmp/backups', new Date('2026-08-13T10:15:30.123Z'))
  const b = resolveBackupDir('/tmp/backups', new Date('2026-08-13T10:15:31.000Z'))
  assert.notEqual(a, b)
})

test('backupAll: 4개 테이블을 각각 JSON 파일로, 베이스 디렉터리 아래 타임스탬프 하위 디렉터리에 백업한다', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'rewrite-backup-test-'))
  try {
    const s = makeReadSupabase({
      artists: [{ id: 'a1', profile_photo_url: 'x', profile_photo_metadata: null }],
      posts: [{ id: 'p1', content: '본문' }],
      post_attachments: [],
      event_applications: [],
    })
    const now = new Date('2026-08-13T10:15:30.123Z')
    const resolvedDir = await backupAll(s, baseDir, { now })

    // 반환된 경로가 베이스 디렉터리 바로 아래가 아니라 타임스탬프 하위 디렉터리다
    assert.equal(resolvedDir, `${baseDir}/2026-08-13T10-15-30-123Z`)
    assert.notEqual(resolvedDir, baseDir)

    for (const name of ['artists', 'posts', 'post_attachments', 'event_applications']) {
      assert.equal(existsSync(`${resolvedDir}/${name}.json`), true)
    }
    const artistsBackup = JSON.parse(readFileSync(`${resolvedDir}/artists.json`, 'utf8'))
    assert.deepEqual(artistsBackup, [
      { id: 'a1', profile_photo_url: 'x', profile_photo_metadata: null },
    ])
    const postsBackup = JSON.parse(readFileSync(`${resolvedDir}/posts.json`, 'utf8'))
    assert.deepEqual(postsBackup, [{ id: 'p1', content: '본문' }])
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test('backupAll: 테이블 조회가 실패하면 즉시 던진다 (부분 백업으로 조용히 넘어가지 않는다)', async () => {
  const s = {
    from(name) {
      return {
        select() {
          if (name === 'posts')
            return Promise.resolve({ data: null, error: { message: 'RLS 거부' } })
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
  }
  const baseDir = mkdtempSync(join(tmpdir(), 'rewrite-backup-fail-test-'))
  try {
    await assert.rejects(() => backupAll(s, baseDir, { now: new Date() }), /RLS 거부/)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test('backupAll: 같은 BACKUP_DIR로 두 번 실행해도(예: 실패 후 재실행) 서로 다른 하위 디렉터리에 쌓여 이전 백업을 덮어쓰지 않는다 (Finding 2 회귀)', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'rewrite-backup-rerun-test-'))
  try {
    const s1 = makeReadSupabase({
      artists: [{ id: 'a1', profile_photo_url: 'BEFORE-REWRITE', profile_photo_metadata: null }],
      posts: [],
      post_attachments: [],
      event_applications: [],
    })
    const firstDir = await backupAll(s1, baseDir, { now: new Date('2026-08-13T10:00:00.000Z') })

    // 1차 실행이 중간에 실패해, 재작성이 일부만 적용된 상태로 재실행한다고 가정
    const s2 = makeReadSupabase({
      artists: [
        { id: 'a1', profile_photo_url: 'AFTER-PARTIAL-REWRITE', profile_photo_metadata: null },
      ],
      posts: [],
      post_attachments: [],
      event_applications: [],
    })
    const secondDir = await backupAll(s2, baseDir, { now: new Date('2026-08-13T10:05:00.000Z') })

    assert.notEqual(firstDir, secondDir)

    // 1차 백업(진짜 마이그레이션 시작 전 상태)이 그대로 남아있어야 한다 — 복구 대상
    const firstBackup = JSON.parse(readFileSync(`${firstDir}/artists.json`, 'utf8'))
    assert.equal(firstBackup[0].profile_photo_url, 'BEFORE-REWRITE')

    const secondBackup = JSON.parse(readFileSync(`${secondDir}/artists.json`, 'utf8'))
    assert.equal(secondBackup[0].profile_photo_url, 'AFTER-PARTIAL-REWRITE')
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test('backupAll: 계산된 디렉터리가 이미 존재하고 비어있지 않으면 덮어쓰지 않고 던진다', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'rewrite-backup-collision-test-'))
  try {
    const now = new Date('2026-08-13T10:15:30.123Z')
    const collidingDir = resolveBackupDir(baseDir, now)
    mkdirSync(collidingDir, { recursive: true })
    writeFileSync(`${collidingDir}/artists.json`, JSON.stringify([{ id: 'previous-backup' }]))

    const s = makeReadSupabase({
      artists: [],
      posts: [],
      post_attachments: [],
      event_applications: [],
    })

    await assert.rejects(() => backupAll(s, baseDir, { now }), /이미 존재하고 비어있지 않다/)

    // 기존 백업 파일이 그대로 남아있어야 한다 — 덮어쓰이지 않았다
    const preserved = JSON.parse(readFileSync(`${collidingDir}/artists.json`, 'utf8'))
    assert.deepEqual(preserved, [{ id: 'previous-backup' }])
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// restoreFromBackup — 복원 스크립트 자체의 정확성 검증
// (감사에서 지적된 "검증된 적 없는 롤백" 문제를 여기서 막는다)
// ---------------------------------------------------------------------------

const BACKUP_TABLES = ['artists', 'posts', 'post_attachments', 'event_applications']

function writeEmptyBackup(dir, overrides = {}) {
  for (const name of BACKUP_TABLES) {
    writeFileSync(`${dir}/${name}.json`, JSON.stringify(overrides[name] ?? []))
  }
}

/** 복원 대상 가짜 Supabase. id로 매칭되는 행만 갱신하고 모든 호출을 calls에 기록한다. */
function makeRestoreFakeSupabase(store, { failFor } = {}) {
  const calls = []
  const client = {
    from(table) {
      return {
        update(patch) {
          return {
            eq(col, val) {
              return {
                select() {
                  calls.push({ table, id: val, patch })
                  if (failFor?.(table, val)) {
                    return Promise.resolve({ data: null, error: { message: '갱신 실패' } })
                  }
                  const rows = store[table] ?? []
                  const row = rows.find(r => r[col] === val)
                  if (!row) return Promise.resolve({ data: [], error: null })
                  Object.assign(row, patch)
                  return Promise.resolve({ data: [{ id: row.id }], error: null })
                },
              }
            },
          }
        },
      }
    },
  }
  return { client, calls }
}

test('restoreFromBackup: 백업 시점 값으로 그대로 되돌린다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-test-'))
  try {
    writeEmptyBackup(dir, {
      artists: [
        {
          id: 'a1',
          profile_photo_url: `${SUPA}/artists/a1/old.webp`,
          profile_photo_metadata: null,
        },
      ],
    })
    const store = {
      artists: [
        {
          id: 'a1',
          profile_photo_url: `${BASE}/artists/a1/new.webp`,
          profile_photo_metadata: { x: 1 },
        },
      ],
    }
    const { client, calls } = makeRestoreFakeSupabase(store)

    const r = await restoreFromBackup(client, dir, { dryRun: false })

    assert.equal(r.restored, 1)
    assert.deepEqual(r.failures, [])
    assert.equal(store.artists[0].profile_photo_url, `${SUPA}/artists/a1/old.webp`)
    assert.equal(store.artists[0].profile_photo_metadata, null)
    assert.equal(calls.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restoreFromBackup: dry-run은 UPDATE를 한 건도 호출하지 않는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-dryrun-test-'))
  try {
    writeEmptyBackup(dir, {
      artists: [{ id: 'a1', profile_photo_url: 'old', profile_photo_metadata: null }],
    })
    const store = {
      artists: [{ id: 'a1', profile_photo_url: 'current-unchanged', profile_photo_metadata: null }],
    }
    const { client, calls } = makeRestoreFakeSupabase(store)

    const r = await restoreFromBackup(client, dir, { dryRun: true })

    assert.equal(r.restored, 1)
    assert.equal(calls.length, 0) // 쓰기 호출이 전혀 없어야 한다
    assert.equal(store.artists[0].profile_photo_url, 'current-unchanged') // DB 상태 불변
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restoreFromBackup: 백업 파일이 없으면 실패로 기록하고 나머지 테이블은 계속 처리한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-missing-file-test-'))
  try {
    // artists.json만 쓰고 나머지 3개는 아예 만들지 않는다
    writeFileSync(`${dir}/artists.json`, JSON.stringify([]))
    const { client } = makeRestoreFakeSupabase({})

    const r = await restoreFromBackup(client, dir, { dryRun: false })

    assert.equal(r.failures.length, 3)
    assert.equal(
      r.failures.some(f => f.includes('posts')),
      true
    )
    assert.equal(
      r.failures.some(f => f.includes('post_attachments')),
      true
    )
    assert.equal(
      r.failures.some(f => f.includes('event_applications')),
      true
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restoreFromBackup: 백업된 행이 DB에서 사라졌으면(대상 없음) 실패로 기록한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-gone-row-test-'))
  try {
    writeEmptyBackup(dir, {
      artists: [{ id: 'a-deleted', profile_photo_url: 'old', profile_photo_metadata: null }],
    })
    const { client } = makeRestoreFakeSupabase({ artists: [] }) // 해당 id가 이제 DB에 없다

    const r = await restoreFromBackup(client, dir, { dryRun: false })

    assert.equal(r.restored, 0)
    assert.equal(r.failures.length, 1)
    assert.equal(r.failures[0].includes('a-deleted'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restoreFromBackup: UPDATE 에러는 조용히 삼켜지지 않고 실패로 기록된다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-update-error-test-'))
  try {
    writeEmptyBackup(dir, {
      artists: [{ id: 'a1', profile_photo_url: 'old', profile_photo_metadata: null }],
    })
    const store = {
      artists: [{ id: 'a1', profile_photo_url: 'current', profile_photo_metadata: null }],
    }
    const { client } = makeRestoreFakeSupabase(store, { failFor: table => table === 'artists' })

    const r = await restoreFromBackup(client, dir, { dryRun: false })

    assert.equal(r.restored, 0)
    assert.equal(r.failures.length, 1)
    assert.equal(r.failures[0].includes('갱신 실패'), true)
    // 실패했으니 DB 값은 원래대로 남아 있어야 한다 (잘못된 값으로 덮이지 않음)
    assert.equal(store.artists[0].profile_photo_url, 'current')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restoreFromBackup: 여러 테이블에 걸쳐 성공/실패가 섞여도 각각 독립적으로 집계된다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-mixed-test-'))
  try {
    writeEmptyBackup(dir, {
      artists: [{ id: 'a1', profile_photo_url: 'old-a', profile_photo_metadata: null }],
      posts: [{ id: 'p1', content: 'old-content' }],
    })
    const store = {
      artists: [{ id: 'a1', profile_photo_url: 'new-a', profile_photo_metadata: null }],
      posts: [], // p1이 그 사이 삭제됨
    }
    const { client } = makeRestoreFakeSupabase(store)

    const r = await restoreFromBackup(client, dir, { dryRun: false })

    assert.equal(r.restored, 1) // artists만 성공
    assert.equal(r.failures.length, 1) // posts는 대상 없음
    assert.equal(store.artists[0].profile_photo_url, 'old-a')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
