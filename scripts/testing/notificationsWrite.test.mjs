import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { markAllNotificationsRead } from '../../src/lib/server/notificationsWrite.ts'

/**
 * Supabase 클라이언트의 최소 스텁. update().eq().is().select() 체인만
 * 흉내낸다 — `systemSettingsWrite.test.mjs`의 stubAdmin과 같은 형태.
 */
function stubClient(result) {
  const calls = []
  const chain = {
    update(payload) {
      calls.push({ op: 'update', payload })
      return chain
    },
    eq(column, value) {
      calls.push({ op: 'eq', column, value })
      return chain
    },
    is(column, value) {
      calls.push({ op: 'is', column, value })
      return chain
    },
    select() {
      calls.push({ op: 'select' })
      return chain
    },
    then(resolve) {
      resolve(result)
    },
  }
  return {
    calls,
    client: { from: table => (calls.push({ op: 'from', table }), chain) },
  }
}

describe('markAllNotificationsRead', () => {
  it('갱신된 행들의 id를 돌려준다', async () => {
    const { client } = stubClient({ data: [{ id: 'n-1' }, { id: 'n-2' }], error: null })
    const result = await markAllNotificationsRead(client, 'user-1')
    assert.deepEqual(result.updatedIds, ['n-1', 'n-2'])
  })

  it('user_id로 대상을 좁힌다 — auth.uid()가 아니라 세션의 userId를 직접 쓴다', async () => {
    const { calls, client } = stubClient({ data: [{ id: 'n-1' }], error: null })
    await markAllNotificationsRead(client, 'user-1')
    const eqUserId = calls.find(c => c.op === 'eq' && c.column === 'user_id')
    assert.ok(eqUserId, 'user_id 필터가 쿼리에 있어야 한다')
    assert.equal(eqUserId.value, 'user-1')
  })

  it('read_at에 실제 타임스탬프 문자열을 쓴다 — null이나 빈 값이 아니라', async () => {
    const { calls, client } = stubClient({ data: [{ id: 'n-1' }], error: null })
    await markAllNotificationsRead(client, 'user-1')
    const update = calls.find(c => c.op === 'update')
    assert.ok(update, 'update 호출이 있어야 한다')
    assert.equal(typeof update.payload.read_at, 'string')
    assert.ok(
      !Number.isNaN(Date.parse(update.payload.read_at)),
      'read_at은 파싱 가능한 ISO 타임스탬프여야 한다'
    )
  })

  it('read_at이 이미 채워진 알림은 건드리지 않는다(is read_at null 필터)', async () => {
    const { calls, client } = stubClient({ data: [], error: null })
    await markAllNotificationsRead(client, 'user-1')
    const isReadAtNull = calls.find(c => c.op === 'is' && c.column === 'read_at')
    assert.ok(isReadAtNull, 'read_at IS NULL 필터가 쿼리에 있어야 한다')
    assert.equal(isReadAtNull.value, null)
  })

  it('데이터가 없으면 빈 배열을 돌려준다', async () => {
    const { client } = stubClient({ data: null, error: null })
    const result = await markAllNotificationsRead(client, 'user-1')
    assert.deepEqual(result.updatedIds, [])
  })

  it('에러가 나면 던진다', async () => {
    const { client } = stubClient({ data: null, error: new Error('db down') })
    await assert.rejects(() => markAllNotificationsRead(client, 'user-1'), /db down/)
  })
})
