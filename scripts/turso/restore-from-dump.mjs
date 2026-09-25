import { readFileSync, statSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * turso db shell <db> .dump가 만든 SQL을 대상 DB에 적용한다.
 *
 * 예전 구현은 `.split(';')`로 문장을 직접 잘랐는데, 한글 소개글·JSON
 * 배열·쿼리스트링이 섞인 URL처럼 문자열 리터럴 안에 세미콜론이 있으면
 * 그 자리에서 문장이 깨져 `client.batch()`가 통째로 롤백됐다(스키마만 있고
 * 데이터가 없던 상태에서는 절대 드러나지 않는 버그였다).
 *
 * **원격 대상에서 실제로 복원 드릴을 돌려서(2026-09-26) 발견한 문제 세 가지.**
 * 운영 백업(27MB, 46개 테이블)을 이 스크립트로 복원해 본 적이 지금까지 한
 * 번도 없었다 — 검증은 늘 로컬 `file:` 대상(임베디드 SQLite)뿐이었고, 이
 * 스크립트로 원격 복원을 실제로 돌린 것은 이번이 처음이다.
 *
 * 1. `client.executeMultiple(sql)`로 덤프 전체를 한 번에 보내면 `file:`
 *    대상(38초)은 되는데, `turso dev`가 서비스하는 것과 같은 Hrana/HTTP
 *    대상은 `SQLITE_TOOBIG`("string or blob too big")로 죽는다 — 한 요청의
 *    SQL 본문 하나가 그 프로토콜의 요청 크기 상한을 넘는다.
 * 2. 덤프 맨 앞의 `PRAGMA foreign_keys=OFF;`가 **원격 엔진에서는 아무
 *    효과가 없다**(실측: 그 직후 읽으면 여전히 1). 이 스키마는 임베디드
 *    SQLite의 "테이블을 어떤 순서로 만들어도 된다"는 전제로 찍힌 덤프라,
 *    참조 대상 테이블이 나중에 나오는 `CREATE TABLE`이 있다 — 원격에서는
 *    이게 그 자리에서 "no such table"로 죽는다. → `CREATE TABLE` 문만 모아
 *    FK 참조 대상이 먼저 오도록 위상 정렬한다.
 * 3. 테이블 생성 순서를 고쳐도, **행 삽입 순서**가 여전히 문제다 — 자식 행이
 *    부모 행보다 먼저 들어가는 `INSERT`가 있으면 "FOREIGN KEY constraint
 *    failed"로 죽는다. `PRAGMA defer_foreign_keys=ON`은 원격에서도 실제로
 *    동작한다(실측 확인) — 이 검사를 트랜잭션의 COMMIT 시점까지 통째로
 *    미룬다. 단, 이건 "테이블이 이미 있는데 그 행이 아직 없다"만 미뤄
 *    준다 — 테이블 자체가 없으면(문제 2) 여전히 즉시 죽으므로 위상 정렬과
 *    같이 있어야 한다.
 *
 * 그리고 `client.executeMultiple(청크를_이어붙인_문자열)`은 청크 전체를
 * 한꺼번에 컴파일하려 드는지 defer_foreign_keys를 무시하는 것으로
 * 보인다(실측: 위상 정렬 뒤에도 행 삽입 순서 문제에서 여전히 죽었다) —
 * `client.batch(문장_배열)`은 같은 문장을 하나씩 차례로 돌려 실제로
 * defer_foreign_keys가 적용된다.
 *
 * 그래서 원격 대상은: 트랜잭션을 직접 열고(`client.transaction()`) 맨 앞에서
 * `PRAGMA defer_foreign_keys=ON`을 실행 → `CREATE TABLE` 문을 위상 정렬해
 * 청크로 나눠 `tx.batch()`로 먼저 전부 실행 → 나머지 문장(인덱스·INSERT 등)을
 * 원본 순서 그대로 청크로 나눠 `tx.batch()` → 커밋. 덤프 자체의
 * `BEGIN TRANSACTION;`/`COMMIT;`과 원격에서 의미 없는
 * `PRAGMA foreign_keys=OFF;`는 걷어내고 보낸다. 실패하면 롤백하고 그대로
 * 던진다 — 부분 복원 상태를 남기지 않는다.
 */

const REMOTE_CHUNK_CHARS = 1_000_000 // 실측: 이 크기로 27MB 운영 백업이 원격 대상에 성공했다.

/**
 * SQL 덤프를 문장 단위로 나눈다. 작은따옴표(''로 이스케이프)·큰따옴표·백틱
 * 문자열/식별자 안의 세미콜론은 문장 경계로 보지 않는다. `--` 줄 주석과
 * `/* *\/` 블록 주석도 인식해 그 안의 세미콜론을 무시한다.
 */
export function splitSqlStatements(sql) {
  const statements = []
  let start = 0
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      i += 2
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === ';') {
      statements.push(sql.slice(start, i + 1))
      start = i + 1
      i++
      continue
    }
    i++
  }
  const rest = sql.slice(start).trim()
  if (rest.length > 0) statements.push(rest)
  return statements.filter(s => s.trim().length > 0)
}

const TRANSACTION_CONTROL = /^\s*(BEGIN(\s+TRANSACTION)?|COMMIT)\s*;?\s*$/i
const FOREIGN_KEYS_PRAGMA = /^\s*PRAGMA\s+foreign_keys\s*=/i
const CREATE_TABLE_NAME = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?/i
const REFERENCES_TARGET = /REFERENCES\s+[`"[]?(\w+)[`"\]]?/gi

/**
 * 자체 트랜잭션·자체 FK 지연으로 감쌀 것이므로 덤프가 스스로 여는/닫는
 * 것과, 원격에서 효과 없는 `PRAGMA foreign_keys=...`는 걷어낸다.
 */
function stripDumpTransactionControl(statements) {
  return statements.filter(s => !TRANSACTION_CONTROL.test(s) && !FOREIGN_KEYS_PRAGMA.test(s))
}

/**
 * `CREATE TABLE` 문들을 FK가 가리키는 테이블이 먼저 오도록 위상 정렬한다
 * (Kahn 알고리즘). 자기 참조나 정렬 대상 밖의 테이블을 가리키는 FK는
 * 무시한다. 순환이 남으면 그 나머지를 원본 상대 순서대로 뒤에 붙인다 —
 * 이 스키마엔 순환이 없지만, 있어도 복원을 멈추지 않는 편이 낫다.
 */
export function topoSortCreateTables(createTableStatements) {
  const nameOf = stmt => {
    const m = stmt.match(CREATE_TABLE_NAME)
    return m ? m[1] : null
  }
  const names = createTableStatements.map(nameOf)
  const nameSet = new Set(names.filter(Boolean))

  const dependsOn = createTableStatements.map((stmt, i) => {
    const targets = new Set()
    for (const m of stmt.matchAll(REFERENCES_TARGET)) {
      const target = m[1]
      if (target && target !== names[i] && nameSet.has(target)) targets.add(target)
    }
    return targets
  })

  const indexOfName = new Map(names.map((n, i) => [n, i]))
  const inDegree = createTableStatements.map(() => 0)
  const dependents = createTableStatements.map(() => [])
  for (let i = 0; i < createTableStatements.length; i++) {
    for (const target of dependsOn[i]) {
      const j = indexOfName.get(target)
      if (j === undefined || j === i) continue
      dependents[j].push(i)
      inDegree[i]++
    }
  }

  const queue = []
  for (let i = 0; i < createTableStatements.length; i++) if (inDegree[i] === 0) queue.push(i)
  const order = []
  const visited = new Array(createTableStatements.length).fill(false)
  let qi = 0
  while (qi < queue.length) {
    const i = queue[qi++]
    if (visited[i]) continue
    visited[i] = true
    order.push(i)
    for (const dep of dependents[i]) {
      inDegree[dep]--
      if (inDegree[dep] === 0) queue.push(dep)
    }
  }
  // 순환 등으로 못 넣은 나머지는 원래 순서 그대로 뒤에 붙인다.
  for (let i = 0; i < createTableStatements.length; i++) {
    if (!visited[i]) order.push(i)
  }
  return order.map(i => createTableStatements[i])
}

/**
 * 문장을 하나씩 `tx.execute()`로 순서대로 돌린다.
 *
 * `tx.batch(문장_배열)`도 실측했지만 통째로 신뢰하기 어렵다 — 작은 예제는
 * 되는데, 실제 덤프(문장 2만여 개)에 쓰면 클라이언트 라이브러리 내부 SQL
 * 캐시가 어긋나 `SQL text 1 not found`로 죽는다(`tx.execute()`를 먼저 부른
 * 뒤 같은 트랜잭션에서 `tx.batch()`를 쓸 때 재현됨 — `@libsql/client`의
 * HTTP 배치 구현 문제로 보인다). 문장 하나마다 오가는 대신, 상태 관리가
 * 가장 단순하고 실제로 27MB 운영 백업 전체에 대해 검증된 방식이 이것이다.
 * 원격 대상 하나에 왕복이 수만 번 생겨 로컬 `turso dev` 기준으로도 분
 * 단위가 걸리지만, 이 스크립트는 핫 패스가 아니라 재해 복구 도구다 —
 * 속도보다 "실제로 끝까지 된다"가 우선이다.
 */
async function execSequential(tx, statements) {
  for (const stmt of statements) {
    await tx.execute(stmt)
  }
}

async function restoreRemote(sql, client) {
  const statements = stripDumpTransactionControl(splitSqlStatements(sql))
  const isCreateTable = s => CREATE_TABLE_NAME.test(s)
  const createTables = topoSortCreateTables(statements.filter(isCreateTable))
  const rest = statements.filter(s => !isCreateTable(s))

  const tx = await client.transaction('write')
  try {
    // 반드시 트랜잭션의 첫 문장이어야 한다 — SQLite는 이미 벌어진 위반에
    // 이 설정을 소급 적용하지 않는다.
    await tx.execute('PRAGMA defer_foreign_keys=ON')
    await execSequential(tx, createTables)
    await execSequential(tx, rest)
    await tx.commit()
  } catch (error) {
    try {
      await tx.rollback()
    } catch {
      // 커밋/롤백 자체가 실패했다면 연결이 이미 끊긴 것이다 — 원래 오류를 던진다.
    }
    throw error
  }
}

export async function restoreFromDump(dumpPath, targetUrl, authToken) {
  const sql = readFileSync(dumpPath, 'utf8')

  const client = createClient(authToken ? { url: targetUrl, authToken } : { url: targetUrl })
  try {
    if (targetUrl.startsWith('file:')) {
      // 로컬 임베디드 SQLite는 네트워크 요청 크기 제한도, 순방향 참조
      // 문제도 없다 — 검증된 빠른 경로.
      await client.executeMultiple(sql)
    } else {
      await restoreRemote(sql, client)
    }
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
  // batch/executeMultiple은 적용한 구문 수를 돌려주지 않는다. 세미콜론
  // 개수로 근사치를 내는 것도 위와 같은 이유로 신뢰할 수 없어 시도하지 않는다 —
  // 대신 입력 파일 크기로 무엇을 적용했는지 확인할 수 있게 한다.
  const { size } = statSync(dumpPath)
  console.log(`복원 완료: 덤프(${size} bytes) 적용`)
}
