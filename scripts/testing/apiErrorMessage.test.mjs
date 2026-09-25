import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apiErrorMessage } from '../../src/lib/funding/apiErrorMessage.ts'

test('ApiError 표준 응답(error가 문자열)이면 그 문자열을 쓴다', () => {
  assert.equal(
    apiErrorMessage({ success: false, error: '이미 처리된 항목입니다.' }, '기본 문구'),
    '이미 처리된 항목입니다.'
  )
})

test('error가 { message } 객체여도 message를 꺼낸다', () => {
  assert.equal(
    apiErrorMessage({ success: false, error: { message: '레거시 형태' } }, '기본 문구'),
    '레거시 형태'
  )
})

test('error가 없거나 빈 문자열이면 fallback을 쓴다', () => {
  assert.equal(apiErrorMessage({ success: false }, '기본 문구'), '기본 문구')
  assert.equal(apiErrorMessage({ success: false, error: '' }, '기본 문구'), '기본 문구')
  assert.equal(apiErrorMessage(null, '기본 문구'), '기본 문구')
  assert.equal(apiErrorMessage(undefined, '기본 문구'), '기본 문구')
})

test('error 객체에 message가 없으면 fallback을 쓴다', () => {
  assert.equal(apiErrorMessage({ success: false, error: {} }, '기본 문구'), '기본 문구')
})
