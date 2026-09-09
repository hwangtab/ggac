import { test } from 'node:test'
import assert from 'node:assert/strict'

const { DOCUMENT_VISIBILITY, isDocumentVisibility } = await import(
  '../../src/constants/boardRoom.ts'
)

test('허용값은 board와 members 둘뿐이다', () => {
  assert.deepEqual([...DOCUMENT_VISIBILITY], ['board', 'members'])
})

test('허용값이 아니면 거른다', () => {
  assert.equal(isDocumentVisibility('board'), true)
  assert.equal(isDocumentVisibility('members'), true)
  assert.equal(isDocumentVisibility('public'), false)
  assert.equal(isDocumentVisibility(''), false)
  assert.equal(isDocumentVisibility(null), false)
  assert.equal(isDocumentVisibility(undefined), false)
})
