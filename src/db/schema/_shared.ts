import { sql } from 'drizzle-orm'
import { integer, text } from 'drizzle-orm/sqlite-core'

/** Postgres uuid → SQLite text. 기존 UUID 문자열을 그대로 보존한다. */
export const uuidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

/**
 * SQL DEFAULT. Drizzle을 거치지 않는 쓰기(`turso db shell`, `scripts/turso/*`,
 * 복구·백필)가 `NOT NULL constraint failed`로 죽지 않게 한다 — 0019가 기존 표
 * 전부에 같은 DEFAULT를 붙였고, 새 표는 이 헬퍼로 처음부터 갖는다.
 * `auth.ts`의 Better Auth 표와 같은 식이다.
 *
 * 컬럼마다 새 `sql` 객체를 만든다 — 상수 하나를 여러 컬럼이 공유하면
 * drizzle-kit이 DDL을 뽑을 때 깨진다.
 */
export const nowMs = () => sql`(cast(unixepoch('subsecond') * 1000 as integer))`

/** Postgres timestamptz → epoch ms. 표시 계층에서만 KST로 변환한다. */
export const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(nowMs())
    .$defaultFn(() => new Date())

export const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(nowMs())
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
