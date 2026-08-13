import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const TABLES = [
  { name: 'artists', cols: ['profile_photo_url', 'profile_photo_metadata'] },
  { name: 'posts', cols: ['content'] },
  { name: 'post_attachments', cols: ['file_url'] },
  { name: 'event_applications', cols: ['photo_url'] },
]

/**
 * 백업 디렉터리에 저장된 백업 시점 값을 그대로 되돌린다.
 *
 * 무조건 되돌린다 — rewrite-db-urls.mjs 이후 정상적으로 바뀐 값(예: 조합원이
 * 새로 올린 사진)도 함께 되돌아간다는 뜻이다. 사고 발생 시 되돌리는 용도이므로
 * 그게 맞는 동작이다. 되돌리기 전에 최신 데이터가 필요하면 별도로 백업해둘 것.
 *
 * 백업 파일이 없거나 손상됐으면 해당 테이블만 실패로 기록하고 나머지 테이블은
 * 계속 처리한다. UPDATE 에러나 "대상 행 없음"(그 사이 행이 삭제됨)도 조용히
 * 삼키지 않고 failures에 남긴다.
 */
export async function restoreFromBackup(supabase, dir, { dryRun = false } = {}) {
  let restored = 0
  const failures = []

  for (const t of TABLES) {
    let rows
    try {
      rows = JSON.parse(readFileSync(`${dir}/${t.name}.json`, 'utf8'))
    } catch (e) {
      failures.push(`${t.name}: 백업 읽기 실패 ${e.message}`)
      continue
    }

    for (const row of rows) {
      const patch = {}
      for (const c of t.cols) patch[c] = row[c]
      if (dryRun) {
        restored++
        continue
      }
      const { data, error } = await supabase
        .from(t.name)
        .update(patch)
        .eq('id', row.id)
        .select('id')
      if (error) failures.push(`${t.name} ${row.id}: ${error.message}`)
      else if (!data?.length) failures.push(`${t.name} ${row.id}: 대상 행 없음`)
      else restored++
    }
  }

  return { restored, failures }
}

if (process.argv[1]?.endsWith('restore-db-urls.mjs')) {
  const dryRun = process.argv.includes('--dry-run')
  const dir = process.env.BACKUP_DIR
  if (!dir) throw new Error('BACKUP_DIR이 필요하다')

  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false },
    }
  )

  const r = await restoreFromBackup(s, dir, { dryRun })
  console.log(dryRun ? `[dry-run] 복원 대상 ${r.restored}행` : `복원 ${r.restored}행`)
  for (const f of r.failures) console.error('  실패:', f)
  process.exitCode = r.failures.length ? 1 : 0
}
