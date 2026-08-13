import { mkdirSync, writeFileSync } from 'node:fs'
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

export async function backupAll(supabase, dir) {
  mkdirSync(dir, { recursive: true })
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t.name).select(t.cols)
    if (error) throw new Error(`${t.name} 백업 실패: ${error.message}`)
    writeFileSync(`${dir}/${t.name}.json`, JSON.stringify(data, null, 2))
    console.log(`백업 ${t.name}: ${data.length}행`)
  }
}

/**
 * 읽은 값(previous)과 DB 값이 여전히 같을 때만 쓴다 — 데이터 유실 가드.
 * SELECT와 UPDATE 사이에 다른 곳(조합원의 새 사진 업로드 등)에서 값이
 * 바뀌었으면 조건이 매치되지 않아 0행이 갱신되고, 그 경우 건드리지 않는다.
 *
 * previous는 { 컬럼명: 읽었을 때의 값 } 형태다. 값이 null이면 `.is()`로,
 * 아니면 `.eq()`로 조건을 건다.
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

  const backupDir = process.env.BACKUP_DIR
  if (!dryRun) {
    if (!backupDir) throw new Error('BACKUP_DIR이 필요하다')
    await backupAll(s, backupDir)
  }

  let changed = 0
  let skipped = 0
  const fail = (t, id, msg) => {
    console.error(`  실패 ${t} ${id}: ${msg}`)
    process.exitCode = 1
  }

  // artists — url과 metadata를 함께
  {
    const { data, error } = await s
      .from('artists')
      .select('id, profile_photo_url, profile_photo_metadata')
    if (error) throw new Error(error.message)
    for (const a of data) {
      const url = rewriteUrl(a.profile_photo_url, blobBase)
      const metaJson = rewriteAllInText(JSON.stringify(a.profile_photo_metadata ?? {}), blobBase)
      const meta = JSON.parse(metaJson)
      const metaChanged = metaJson !== JSON.stringify(a.profile_photo_metadata ?? {})
      if (url === a.profile_photo_url && !metaChanged) continue

      console.log(`artists ${a.id}`)
      if (dryRun) {
        changed++
        continue
      }

      // 읽은 값과 같을 때만 쓴다 — 그 사이 조합원이 사진을 바꿨으면 건드리지 않는다
      const result = await conditionalUpdate(
        s,
        'artists',
        a.id,
        { profile_photo_url: url, profile_photo_metadata: meta },
        { profile_photo_url: a.profile_photo_url }
      )
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
