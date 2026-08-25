import { readFileSync } from 'node:fs'

/**
 * 테스트용 파일 DB에 `src/db/migrations`를 **전부, 원장 순서대로** 적용한다.
 *
 * 이전에는 테스트 23개가 마이그레이션 파일 이름을 각자 손으로 나열했다.
 * 마이그레이션이 하나 늘 때마다 23곳을 고쳐야 했고, 빠뜨리면 테스트가
 * **운영과 다른 스키마**를 상대로 초록불을 내는(= 아무것도 증명하지 않는)
 * 상태가 된다. 단계 4 Task 6a에서 0002가 늘면서 원장(`meta/_journal.json`)을
 * 유일한 목록으로 삼도록 합쳤다.
 *
 * 경로는 저장소 루트 기준 상대경로다 — 기존 테스트들과 같은 전제
 * (`npm run test:unit`은 항상 루트에서 돈다).
 */
const MIGRATIONS_DIR = 'src/db/migrations'

/** 원장에 등록된 마이그레이션 SQL 파일 경로를 idx 순서로 돌려준다. */
export function migrationFiles() {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8'))
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(entry => `${MIGRATIONS_DIR}/${entry.tag}.sql`)
}

/**
 * `@libsql/client` 클라이언트에 마이그레이션을 순서대로 적용한다.
 *
 * `executeMultiple`을 쓰는 이유: 0002는 `PRAGMA foreign_keys=OFF`로 표
 * 재작성을 감싸는데, 트랜잭션 안에서 실행되는 마이그레이터(drizzle-kit
 * migrate 등)에서는 그 PRAGMA가 조용히 무시된다. 스크립트로 통째로
 * 실행해야 파일이 선언한 대로 동작한다.
 */
export async function applyMigrations(client) {
  for (const file of migrationFiles()) {
    await client.executeMultiple(readFileSync(file, 'utf8'))
  }
}
