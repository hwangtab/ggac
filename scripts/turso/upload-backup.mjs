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

export async function uploadBackup(localPath, token = requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN')) {
  const stamp = extractDateStamp(basename(localPath))
  const pathname = `${PREFIX}${stamp}.sql.gz`
  const body = readFileSync(localPath)

  const blob = await put(pathname, body, {
    access: 'private',
    contentType: 'application/gzip',
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
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
    const match = blob.pathname.match(/^backups\/(\d{8})\.sql\.gz$/)
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
