import { test } from 'node:test'
import assert from 'node:assert/strict'

const hasCredentials = Boolean(
  process.env.PUBLIC_BLOB_READ_WRITE_TOKEN && process.env.PRIVATE_BLOB_READ_WRITE_TOKEN
)

test('공개 URL을 조립한다', { skip: !hasCredentials }, async () => {
  const { getPublicUrl } = await import('../../src/lib/storage/blob.ts')
  const url = getPublicUrl('artists/sample.webp')
  assert.match(url, /^https:\/\/.+\/artists\/sample\.webp$/)
})

test('공개 저장소에 올리고 URL로 읽고 지운다', { skip: !hasCredentials }, async () => {
  const { putObject, deleteObject } = await import('../../src/lib/storage/blob.ts')
  const pathname = `smoke/public-${Date.now()}.txt`

  const { url } = await putObject('public', pathname, Buffer.from('public-smoke'), 'text/plain')
  assert.match(url, /^https:\/\//)

  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'public-smoke')

  await deleteObject('public', pathname)
})

test('비공개 저장소는 인증 없이 못 읽고 SDK로는 읽힌다', { skip: !hasCredentials }, async () => {
  const { putObject, getPrivateObject, deleteObject } = await import(
    '../../src/lib/storage/blob.ts'
  )
  const pathname = `smoke/private-${Date.now()}.txt`

  const { url } = await putObject('private', pathname, Buffer.from('private-smoke'), 'text/plain')

  // 인증 없는 직접 접근은 거부되어야 한다
  const anonymous = await fetch(url)
  assert.notEqual(anonymous.status, 200)

  // SDK 경유는 읽힌다
  const result = await getPrivateObject(pathname)
  assert.ok(result)
  assert.equal(result.statusCode, 200)
  assert.equal(await new Response(result.stream).text(), 'private-smoke')

  await deleteObject('private', pathname)

  const afterDelete = await getPrivateObject(pathname)
  assert.equal(afterDelete, null)
})
