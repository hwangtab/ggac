import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOpenApiToSnapshot } from './refresh-schema-snapshot.mjs'

test('OpenAPI definitions에서 테이블·컬럼을 추출한다', () => {
  const openapi = {
    definitions: {
      posts: { properties: { id: {}, title: {}, created_at: {} } },
      artists: { properties: { id: {}, profile_photo_url: {} } },
    },
    paths: {
      '/posts': {},
      '/rpc/increment_view_count': {},
      '/rpc/get_board_stats': {},
    },
  }
  const snapshot = parseOpenApiToSnapshot(openapi)
  assert.deepEqual(snapshot.tables.posts, ['created_at', 'id', 'title'])
  assert.deepEqual(snapshot.tables.artists, ['id', 'profile_photo_url'])
  assert.deepEqual(snapshot.rpcs, ['get_board_stats', 'increment_view_count'])
})

test('definitions·paths가 없어도 빈 스냅샷을 반환한다', () => {
  const snapshot = parseOpenApiToSnapshot({})
  assert.deepEqual(snapshot, { tables: {}, rpcs: [] })
})
