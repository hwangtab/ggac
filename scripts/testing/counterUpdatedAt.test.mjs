import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TURSO_DATABASE_URL = 'file:local.db'

const { db } = await import('../../src/db/client.ts')
const { posts } = await import('../../src/db/schema/index.ts')
const { incrementViewCount } = await import('../../src/db/queries/posts.ts')
const { eq, sql } = await import('drizzle-orm')

test('incrementViewCount는 view_count만 올리고 updated_at은 건드리지 않는다', async () => {
  // local.db에는 회원이 없다 — FK를 끄고 임의 작성자로 심는다(시험 행은 곧 지운다).
  await db.run(sql`pragma foreign_keys = off`)
  const author = { id: 'counter-test-author' }
  const old = new Date('2020-01-01T00:00:00Z')
  const [row] = await db
    .insert(posts)
    .values({ title: 't', content: 'c', category: 'free', authorId: author.id, updatedAt: old })
    .returning({ id: posts.id })
  try {
    const n = await incrementViewCount(row.id)
    assert.equal(n, 1)
    const [after] = await db.select().from(posts).where(eq(posts.id, row.id))
    assert.equal(after.viewCount, 1)
    assert.equal(after.updatedAt.getTime(), old.getTime())
  } finally {
    await db.delete(posts).where(eq(posts.id, row.id))
  }
})
