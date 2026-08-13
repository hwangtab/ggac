import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PUBLIC_MARKER = '/storage/v1/object/public/'

export function rewriteUrl(value, blobBase) {
  if (typeof value !== 'string' || !value) return value
  const idx = value.indexOf(PUBLIC_MARKER)
  if (idx === -1) return value
  const logical = value.slice(idx + PUBLIC_MARKER.length)
  if (!logical) return value
  return `${blobBase.replace(/\/$/, '')}/${logical}`
}

/**
 * 다음 https?:// 가 시작되면 매치를 끊는다. 따옴표 없이 인접한 두 URL이
 * 하나로 합쳐져 양쪽 다 망가지는 것을 막는다.
 */
const URL_PATTERN = new RegExp(
  `https?://(?:(?!https?://)[^\\s"'<>)])*${PUBLIC_MARKER.replace(/\//g, '\\/')}(?:(?!https?://)[^\\s"'<>)])+`,
  'g'
)

export function rewriteAllInText(text, blobBase) {
  if (typeof text !== 'string' || !text) return text
  return text.replace(URL_PATTERN, m => rewriteUrl(m, blobBase))
}

const TABLES = [
  { name: 'artists', cols: 'id, profile_photo_url, profile_photo_metadata' },
  { name: 'posts', cols: 'id, content' },
  { name: 'post_attachments', cols: 'id, file_url' },
  { name: 'event_applications', cols: 'id, photo_url' },
]

/**
 * BACKUP_DIR(베이스 디렉터리) 아래에 실행마다 새로운 타임스탬프 하위 디렉터리를
 * 만든다. 같은 BACKUP_DIR을 재사용해 실행을 반복해도(예: 1차 실행이 중간에
 * 실패해 재실행) 이전 백업을 절대 덮어쓰지 않기 위함이다 — 덮어쓰면 정확히
 * 필요한 순간(사고 복구)에 원본 백업이 사라진다.
 */
export function resolveBackupDir(baseDir, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-') // 예: 2026-08-13T10-15-30-123Z
  return `${baseDir.replace(/\/$/, '')}/${stamp}`
}

/**
 * 백업을 만든다. 반환값은 실제로 파일이 쓰인 디렉터리(타임스탬프 하위
 * 디렉터리)의 경로 — 이 경로를 그대로 restore-db-urls.mjs의 BACKUP_DIR로
 * 넘겨야 한다.
 *
 * 방어적으로, 계산된 디렉터리가 이미 존재하고 비어있지 않으면(시계 이상,
 * 같은 밀리초 내 재실행 등 극단적 경우 대비) 조용히 덮어쓰지 않고 즉시
 * throw한다.
 */
export async function backupAll(supabase, baseDir, { now = new Date() } = {}) {
  const dir = resolveBackupDir(baseDir, now)
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`백업 디렉터리가 이미 존재하고 비어있지 않다 — 덮어쓰지 않는다: ${dir}`)
  }
  mkdirSync(dir, { recursive: true })
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t.name).select(t.cols)
    if (error) throw new Error(`${t.name} 백업 실패: ${error.message}`)
    writeFileSync(`${dir}/${t.name}.json`, JSON.stringify(data, null, 2))
    console.log(`백업 ${t.name}: ${data.length}행`)
  }
  return dir
}

/**
 * 읽은 값(previous)과 DB 값이 여전히 같을 때만 쓴다 — 데이터 유실 가드.
 * SELECT와 UPDATE 사이에 다른 곳(조합원의 새 사진 업로드 등)에서 값이
 * 바뀌었으면 조건이 매치되지 않아 0행이 갱신되고, 그 경우 건드리지 않는다.
 *
 * previous는 { 컬럼명: 읽었을 때의 값 } 형태다. 값이 null이면 `.is()`로,
 * 아니면 `.eq()`로 조건을 건다. jsonb 컬럼(profile_photo_metadata)을 가드할
 * 때는 값을 JSON.stringify한 문자열을 넘긴다 — PostgREST가 컬럼의 실제
 * 타입(jsonb)으로 캐스팅해 Postgres의 jsonb 구조적 동등 비교(키 순서 무관)를
 * 수행한다. 프로덕션 스키마로 직접 검증함(아래 "검증" 절 참고) — 같은 값을
 * 되읽어 만든 JSON 문자열은 매치하고, 필드를 하나 추가한 변형은 매치하지
 * 않는다.
 *
 * 반환값의 status:
 *  - 'changed': 조건이 매치되어 실제로 갱신됨
 *  - 'skipped': 조건이 매치되지 않음 (그 사이 값이 바뀜) — 재시도하지 않는다
 *  - 'error': Supabase가 error를 반환함 — 절대 조용히 삼키지 않는다
 */
export async function conditionalUpdate(supabase, table, id, patch, previous) {
  let q = supabase.from(table).update(patch).eq('id', id)
  for (const [col, oldVal] of Object.entries(previous)) {
    q = oldVal === null ? q.is(col, null) : q.eq(col, oldVal)
  }
  const { data, error } = await q.select('id')
  if (error) return { status: 'error', message: error.message }
  if (!data?.length) return { status: 'skipped' }
  return { status: 'changed' }
}

/**
 * artists 행 하나에 대해 필요한 갱신을 계산하는 순수 함수. profile_photo_url과
 * profile_photo_metadata 둘 다 재작성 대상이고, 어느 한쪽만 바뀌어도 두 컬럼
 * 모두 conditionalUpdate의 가드에 들어가야 한다 — 그렇지 않으면 가드가 없는
 * 컬럼(예: metadata)이 그 사이 다른 요청으로 바뀌어도 감지하지 못하고 낡은
 * 값으로 덮어쓴다(실제로 재현된 회귀: src/app/api/mypage/artist/route.ts가
 * profile_photo_url 없이 profile_photo_metadata만 바꾸는 요청을 보낼 수
 * 있다 — profile_photo_url이 Zod 스키마에서 optional이기 때문).
 *
 * metadata가 원래 null이면 그대로 null로 유지한다(빈 객체 `{}`로 바뀌지
 * 않는다) — url만 바뀌고 metadata는 손대지 않아도 되는 행에서 null을
 * `{}`로 조용히 덮어쓰는 부수효과를 막기 위함이다.
 *
 * 갱신이 필요 없으면 null을 반환한다.
 */
export function planArtistPhotoUpdate(row, blobBase) {
  const url = rewriteUrl(row.profile_photo_url, blobBase)
  const urlChanged = url !== row.profile_photo_url

  const originalMeta = row.profile_photo_metadata ?? null
  let meta = originalMeta
  let metaChanged = false
  if (originalMeta !== null) {
    const originalMetaJson = JSON.stringify(originalMeta)
    const rewrittenMetaJson = rewriteAllInText(originalMetaJson, blobBase)
    metaChanged = rewrittenMetaJson !== originalMetaJson
    if (metaChanged) meta = JSON.parse(rewrittenMetaJson)
  }

  if (!urlChanged && !metaChanged) return null

  return {
    patch: { profile_photo_url: url, profile_photo_metadata: meta },
    previous: {
      profile_photo_url: row.profile_photo_url,
      profile_photo_metadata: originalMeta === null ? null : JSON.stringify(originalMeta),
    },
  }
}

if (process.argv[1]?.endsWith('rewrite-db-urls.mjs')) {
  const dryRun = process.argv.includes('--dry-run')
  const blobBase = process.env.BLOB_PUBLIC_BASE_URL
  if (!blobBase) throw new Error('BLOB_PUBLIC_BASE_URL이 필요하다')

  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false },
    }
  )

  // BACKUP_DIR은 베이스 디렉터리다 — 이 실행이 실제로 쓰는 곳은 그 아래
  // 타임스탬프 하위 디렉터리이며, 아래에서 그 경로를 콘솔에 출력한다.
  // restore-db-urls.mjs에는 그 출력된 하위 디렉터리 경로를 그대로 넘긴다.
  const backupBaseDir = process.env.BACKUP_DIR
  if (!dryRun) {
    if (!backupBaseDir) throw new Error('BACKUP_DIR이 필요하다')
    const resolvedBackupDir = await backupAll(s, backupBaseDir)
    console.log(`백업 위치: ${resolvedBackupDir}`)
    console.log(
      `  → 복원 시 restore-db-urls.mjs를 이 경로로 BACKUP_DIR=${resolvedBackupDir} 실행할 것`
    )
  }

  let changed = 0
  let skipped = 0
  const fail = (t, id, msg) => {
    console.error(`  실패 ${t} ${id}: ${msg}`)
    process.exitCode = 1
  }

  // artists — url과 metadata를 함께, 두 컬럼 모두 가드
  {
    const { data, error } = await s
      .from('artists')
      .select('id, profile_photo_url, profile_photo_metadata')
    if (error) throw new Error(error.message)
    for (const a of data) {
      const plan = planArtistPhotoUpdate(a, blobBase)
      if (!plan) continue

      console.log(`artists ${a.id}`)
      if (dryRun) {
        changed++
        continue
      }

      // 읽은 값과 같을 때만 쓴다(url·metadata 둘 다) — 그 사이 조합원이
      // 사진이나 메타데이터를 바꿨으면 건드리지 않는다
      const result = await conditionalUpdate(s, 'artists', a.id, plan.patch, plan.previous)
      if (result.status === 'error') fail('artists', a.id, result.message)
      else if (result.status === 'skipped') {
        skipped++
        console.warn(`  건너뜀 artists ${a.id}: 그 사이 값이 바뀌었다`)
      } else changed++
    }
  }

  // 단일 컬럼 테이블들
  for (const [table, col, isText] of [
    ['posts', 'content', true],
    ['post_attachments', 'file_url', false],
    ['event_applications', 'photo_url', false],
  ]) {
    const { data, error } = await s.from(table).select(`id, ${col}`)
    if (error) throw new Error(error.message)
    for (const row of data) {
      const next = isText ? rewriteAllInText(row[col], blobBase) : rewriteUrl(row[col], blobBase)
      if (next === row[col]) continue

      console.log(`${table} ${row.id}`)
      if (dryRun) {
        changed++
        continue
      }

      const result = await conditionalUpdate(s, table, row.id, { [col]: next }, { [col]: row[col] })
      if (result.status === 'error') fail(table, row.id, result.message)
      else if (result.status === 'skipped') {
        skipped++
        console.warn(`  건너뜀 ${table} ${row.id}: 그 사이 값이 바뀌었다`)
      } else changed++
    }
  }

  console.log(dryRun ? `[dry-run] 대상 ${changed}행` : `재작성 ${changed}행, 건너뜀 ${skipped}행`)
}
