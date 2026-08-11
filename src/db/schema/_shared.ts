import { integer, text } from 'drizzle-orm/sqlite-core'

/** Postgres uuid → SQLite text. 기존 UUID 문자열을 그대로 보존한다. */
export const uuidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

/** Postgres timestamptz → epoch ms. 표시 계층에서만 KST로 변환한다. */
export const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())

export const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
