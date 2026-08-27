// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **직접 실행하면 즉시 중단된다.**
//
// 이 스크립트는 백업 JSON의 값으로 Supabase `artists`·`posts`·
// `post_attachments`·`event_applications`의 URL 컬럼을 **되돌린다**.
// 단계 1a(공개 스토리지 전환)의 롤백 경로였고
// `scripts/turso/README.md`가 복붙용 명령으로 안내하고 있었다(같은 커밋에서 수정).
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
// **이 롤백은 단계 4 컷오버로 사문화됐다.** 앱은 Supabase를 읽지 않으므로
// Supabase의 URL을 되돌려도 화면은 한 픽셀도 안 바뀐다. 되돌려야 할
// 값이 있다면 대상은 Turso의 같은 네 표이고, 백업 JSON의 행 id가 Turso의
// id와 같은지부터 확인해야 한다(`scripts/migrate/lib/`의 매핑 참고).
// 그런 도구는 아직 없다 — 필요해지면 새로 써야 한다.
//
// 가드를 파일 최상단의 top-level `process.exit(1)`이 아니라 진입점 조건문으로
// 두는 이유: 이 모듈은 순수 함수를 export하고 `scripts/testing/`의 단위 테스트가
// 그걸 import한다. top-level에서 나가면 테스트 스위트가 통째로 죽는다.
// import는 그대로 통과하고 **직접 실행만** 막는다.
if (process.argv[1]?.endsWith('restore-db-urls.mjs')) {
  console.error(
    '[중단] 이 스크립트는 Supabase 표의 URL을 백업 시점으로 되돌립니다. 앱은 Supabase를 ' +
      '읽지 않으므로 화면은 바뀌지 않습니다 — 되돌릴 대상은 Turso의 같은 표입니다.'
  )
  process.exit(1)
}
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
