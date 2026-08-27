import { writeFileSync } from 'node:fs'
import { list, get } from '@vercel/blob'

// upload-backup.mjs와 짝을 이룬다. 같은 이유로 blob.ts 대신 @vercel/blob를
// 직접 쓴다(위 스크립트 주석 참고). 비공개 저장소의 객체는 익명 URL로 받을 수
// 없어서 반드시 인증된 SDK 호출(get)을 거쳐야 한다.

const PREFIX = 'backups/'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/** backups/ 아래에서 날짜 이름이 가장 최근인 항목을 찾는다. */
export async function findLatestBackup(token = requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN')) {
  const { blobs } = await list({ prefix: PREFIX, token })

  const dated = blobs
    .map(blob => {
      // 같은 날 두 번째 백업은 `20260827-2.sql.gz` 형태다(upload-backup.mjs가
      // 정상본을 덮어쓰지 않으려고 접미사를 붙인다). 접미사를 받지 않으면
      // **그날의 최신본이 목록에서 통째로 빠져** 더 오래된 백업을 최신이라고
      // 집어 든다 — 적대 감사(2026-08-27)에서 잡혔다.
      const match = blob.pathname.match(/^backups\/(\d{8})(?:-(\d+))?\.sql\.gz$/)
      return match ? { blob, stamp: match[1], seq: Number(match[2] ?? 1) } : null
    })
    .filter(Boolean)
    // 날짜가 같으면 접미사가 큰 쪽(나중에 뜬 것)이 최신이다.
    .sort((a, b) => b.stamp.localeCompare(a.stamp) || b.seq - a.seq)

  return dated[0]?.blob ?? null
}

export async function downloadLatestBackup(
  destPath,
  token = requireEnv('PRIVATE_BLOB_READ_WRITE_TOKEN')
) {
  const latest = await findLatestBackup(token)
  if (!latest) throw new Error('backups/ 아래에 백업이 하나도 없다')

  const result = await get(latest.pathname, { access: 'private', token })
  if (!result) throw new Error(`백업을 찾았지만 내려받기에 실패했다: ${latest.pathname}`)

  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer())
  writeFileSync(destPath, buffer)

  return { pathname: latest.pathname, size: buffer.length }
}

if (process.argv[1]?.endsWith('download-latest-backup.mjs')) {
  const [destPath] = process.argv.slice(2)
  if (!destPath) {
    console.error('usage: node download-latest-backup.mjs <dest-path>')
    process.exit(1)
  }

  const { pathname, size } = await downloadLatestBackup(destPath)
  console.log(`다운로드 완료: ${pathname} -> ${destPath} (${size} bytes)`)
}
