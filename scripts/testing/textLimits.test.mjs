import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { TEXT_LIMITS, textLengthError } = await import('../../src/utils/textLimits.ts')

test('상한 이내면 null을 돌려준다', () => {
  assert.equal(textLengthError('a'.repeat(200), 200, '제목'), null)
  assert.equal(textLengthError('', 200, '제목'), null)
})

test('상한을 넘으면 한글 안내문을 돌려준다', () => {
  const message = textLengthError('a'.repeat(201), 200, '제목')
  assert.equal(message, '제목이 너무 깁니다. 최대 200자까지 입력할 수 있습니다.')
})

test('받침 없는 명사에는 "가"를 붙인다', () => {
  assert.equal(
    textLengthError('0'.repeat(21), 20, '연락처'),
    '연락처가 너무 깁니다. 최대 20자까지 입력할 수 있습니다.'
  )
  assert.match(textLengthError('a'.repeat(6), 5, '댓글'), /^댓글이 /)
  assert.match(textLengthError('a'.repeat(6), 5, '예매자 이름'), /^예매자 이름이 /)
})

test('네 자리가 넘는 상한은 천 단위로 끊어 보여준다', () => {
  assert.match(textLengthError('a'.repeat(50_001), 50_000, '내용'), /최대 50,000자/)
})

test('문자열이 아닌 값은 이 검사의 대상이 아니다', () => {
  // 타입 검증은 각 라우트가 이미 따로 한다 — 여기서 임의 값에 대해
  // "너무 깁니다"라고 말하면 원인을 가리는 안내가 된다.
  for (const value of [undefined, null, 12345, {}, ['a']]) {
    assert.equal(textLengthError(value, 1, '제목'), null)
  }
})

test('상한 값은 라우트가 실제로 쓰는 것과 같은 상수 하나에서 온다', () => {
  assert.deepEqual(TEXT_LIMITS, {
    POST_TITLE: 200,
    POST_CONTENT: 50_000,
    COMMENT_CONTENT: 5_000,
    BOOKER_NAME: 100,
    BOOKER_PHONE: 20,
    BOOKER_EMAIL: 254,
  })
})

// 상한을 두고도 라우트가 부르지 않으면 아무것도 막지 않는다 — 자유 입력을
// 받는 네 라우트가 실제로 이 헬퍼를 통과하는지 못박는다.
const ROUTES = [
  'src/app/api/posts/route.ts',
  'src/app/api/posts/[id]/route.ts',
  'src/app/api/posts/[id]/comments/route.ts',
  'src/app/api/tickets/prepare/route.ts',
]

for (const route of ROUTES) {
  test(`${route}는 길이 상한을 실제로 검사한다`, () => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    assert.match(source, /from '@\/utils\/textLimits'/)
    assert.match(source, /textLengthError\(/)
  })
}
