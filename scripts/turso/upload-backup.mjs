import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { put, list, del } from '@vercel/blob'

// @vercel/blob는 TypeScript 타입 정의를 함께 배포하는 순수 JS 패키지라서
// .mjs에서 바로 import해도 안전하다. 반면 src/lib/storage/blob.ts를 재사용하려면
// 이 스크립트가 .ts를 import해야 하는데, GitHub Actions 러너의 평범한
// `node script.mjs` 실행은 타입 스트리핑 플래그 없이 돌아가 TS 모듈을 읽지
// 못한다(로컬 개발에서는 --experimental-strip-types로 우회 중). CI에서 매일
// 도는 백업 스크립트가 그 플래그에 의존하게 만들고 싶지 않아서, blob.ts를
// 재사용하는 대신 @vercel/blob를 이 스크립트에서 직접 얇게 감쌌다.

const RETENTION_DAYS = 90
const PREFIX = 'backups/'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/** 파일명에서 YYYYMMDD를 뽑는다. 못 찾으면 오늘 날짜(UTC)로 대체한다. */
function extractDateStamp(filename) {
  const match = filename.match(/(\d{8})/)
  if (match) return match[1]
  const now = new Date()
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
    now.getUTCDate()
  ).padStart(2, '0')}`
}

function parseStampToDate(stamp) {
  const year = Number(stamp.slice(0, 4))
  const month = Number(stamp.slice(4, 6))
  const day = Number(stamp.slice(6, 8))
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * 같은 UTC 날짜에 두 번 올릴 때 **덮어쓰지 않는다.**
 *
 * 적대 감사(2026-08-27) 지적 — 경로가 `backups/<UTC날짜>.sql.gz` 하나이고
 * `allowOverwrite: true`라, 같은 날 두 번째 실행이 그날의 정상본을 지웠다.
 * 실제로 2026-08-19에 두 번(수동 트리거 + 정기) 같은 경로에 썼다.
 *
 * **이게 왜 위험한가:** 사고가 났을 때 "새 백업이나 떠 두자"고 수동 트리거를
 * 누르는 것이 자연스러운 반응인데, 그 시점 DB가 이미 손상됐다면 **마지막
 * 정상본을 스스로 덮어쓴다.** 복구 수단을 지우는 버튼이 되는 것이다.
 *
 * 그래서 두 번째부터는 `-2`, `-3` … 접미사를 붙여 **정상본을 보존**한다.
 * 90일 정리(`deleteOldBackups`)는 날짜 접두사로 판정하므로 접미사가 붙어도
 * 같은 날짜로 함께 만료된다.
 */
async function resolveUploadPath(stamp, token) {
  const base = `${PREFIX}${stamp}`
  const { blobs } = await list({ prefix: base, token, limit: 100 })
  if (blobs.length === 0) return `${base}.sql.gz`

  // `20260827.sql.gz`, `20260827-2.sql.gz` … 중 가장 큰 번호 다음을 쓴다.
  let maxSeq = 1
  for (const b of blobs) {
    const m = b.pathname.match(/-(\d+)\.sql\.gz$/)
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]))
  }
  return `${base}-${maxSeq + 1}.sql.gz`
}

export async function uploadBackup(localPath, token = requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN')) {
  const stamp = extractDateStamp(basename(localPath))
  const pathname = await resolveUploadPath(stamp, token)
  const body = readFileSync(localPath)

  const blob = await put(pathname, body, {
    access: 'private',
    contentType: 'application/gzip',
    token,
    addRandomSuffix: false,
    // 위에서 빈 경로를 골랐으므로 덮어쓸 일이 없다. 그래도 false로 두어
    // 경합이 나면 조용히 덮어쓰는 대신 실패하게 한다.
    allowOverwrite: false,
  })

  return { pathname: blob.pathname, size: body.length, stamp }
}

/** 90일 넘은 backups/<YYYYMMDD>.sql.gz 항목을 지운다. 유효한 날짜 이름이 아닌 항목은 건드리지 않는다. */
export async function deleteOldBackups(
  token = requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN'),
  now = new Date(),
  retentionDays = RETENTION_DAYS
) {
  const { blobs } = await list({ prefix: PREFIX, token })
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000

  const deleted = []
  for (const blob of blobs) {
    // 접미사(`-2`, `-3` …)가 붙은 같은 날 백업도 함께 만료시킨다. 안 받으면
    // 그 파일들이 영원히 남아 90일 보존이 무의미해진다.
    const match = blob.pathname.match(/^backups\/(\d{8})(?:-\d+)?\.sql\.gz$/)
    if (!match) continue
    const stampDate = parseStampToDate(match[1])
    if (stampDate.getTime() < cutoff) {
      await del(blob.url, { token })
      deleted.push(blob.pathname)
    }
  }
  return deleted
}

if (process.argv[1]?.endsWith('upload-backup.mjs')) {
  const [localPath] = process.argv.slice(2)
  if (!localPath) {
    console.error('usage: node upload-backup.mjs <dump.sql.gz>')
    process.exit(1)
  }

  const { pathname, size, stamp } = await uploadBackup(localPath)
  console.log(`업로드 완료: ${pathname} (${size} bytes, ${stamp})`)

  const deleted = await deleteOldBackups()
  if (deleted.length) {
    console.log(`90일 지난 백업 ${deleted.length}건 삭제: ${deleted.join(', ')}`)
  } else {
    console.log('90일 지난 백업 없음')
  }
}
