import { readFileSync, statSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * turso db shell <db> .dump가 만든 SQL을 대상 DB에 적용한다.
 *
 * 예전 구현은 `.split(';')`로 문장을 직접 잘랐는데, 한글 소개글·JSON
 * 배열·쿼리스트링이 섞인 URL처럼 문자열 리터럴 안에 세미콜론이 있으면
 * 그 자리에서 문장이 깨져 `client.batch()`가 통째로 롤백됐다(스키마만 있고
 * 데이터가 없던 상태에서는 절대 드러나지 않는 버그였다). `client.executeMultiple`은
 * 로컬 파일 대상일 때 SQLite 자체 파서(db.exec)에, 원격 대상일 때는 서버 쪽
 * 파서에 위임하므로 문자열 리터럴을 올바르게 인식하고, BEGIN/COMMIT/PRAGMA도
 * 직접 처리한다 — 수동 필터링이 필요 없다.
 */
export async function restoreFromDump(dumpPath, targetUrl, authToken) {
  const sql = readFileSync(dumpPath, 'utf8')

  const client = createClient(authToken ? { url: targetUrl, authToken } : { url: targetUrl })
  try {
    await client.executeMultiple(sql)
  } finally {
    client.close()
  }
}

if (process.argv[1]?.endsWith('restore-from-dump.mjs')) {
  const [dumpPath, targetUrl] = process.argv.slice(2)
  if (!dumpPath || !targetUrl) {
    console.error('usage: node restore-from-dump.mjs <dump.sql> <target-url>')
    process.exit(1)
  }
  await restoreFromDump(dumpPath, targetUrl, process.env.TURSO_AUTH_TOKEN)
  // executeMultiple은 적용한 구문 수를 돌려주지 않는다(반환값 없음). 세미콜론
  // 개수로 근사치를 내는 것도 위와 같은 이유로 신뢰할 수 없어 시도하지 않는다 —
  // 대신 입력 파일 크기로 무엇을 적용했는지 확인할 수 있게 한다.
  const { size } = statSync(dumpPath)
  console.log(`복원 완료: 덤프(${size} bytes) 적용`)
}
