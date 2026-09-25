import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

const { checkMagicBytes } = await import('../../src/lib/storage/imageUpload.ts')
const { hasValidFileSignature } = await import('../../src/utils/fileUploadValidation.ts')

/**
 * RIFF는 WebP 전용 서명이 아니라 **컨테이너 포맷**이다. WAV·AVI도 같은 네
 * 글자로 시작하므로, 'RIFF'만 보고 통과시키면 오디오·영상 파일이
 * `image/webp`라는 이름표를 달고 저장된다. 무엇이 들었는지는 8바이트째
 * fourCC가 말한다.
 */
function riffFile(fourCC, payload = 'payloadpayload') {
  const body = Buffer.from(payload)
  const head = Buffer.alloc(12)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(body.length + 4, 4) // 파일 크기 — 값이 정해져 있지 않은 자리
  head.write(fourCC, 8, 'ascii')
  return Buffer.concat([head, body])
}

const WEBP = riffFile('WEBP')
const WAVE = riffFile('WAVE')
const AVI = riffFile('AVI ')

for (const [name, check] of [
  ['checkMagicBytes', checkMagicBytes],
  ['hasValidFileSignature', hasValidFileSignature],
]) {
  test(`${name}: 진짜 WebP는 통과시킨다`, () => {
    assert.equal(check(WEBP, 'image/webp'), true)
  })

  test(`${name}: RIFF로 시작하는 WAV를 image/webp로 받지 않는다`, () => {
    assert.equal(check(WAVE, 'image/webp'), false)
  })

  test(`${name}: RIFF로 시작하는 AVI를 image/webp로 받지 않는다`, () => {
    assert.equal(check(AVI, 'image/webp'), false)
  })

  test(`${name}: 'RIFF' 네 글자만 있는 아무 파일을 받지 않는다`, () => {
    assert.equal(check(Buffer.from('RIFF그냥아무거나'), 'image/webp'), false)
  })

  test(`${name}: 헤더가 잘린 짧은 버퍼를 받지 않는다`, () => {
    assert.equal(check(Buffer.from('RIFF'), 'image/webp'), false)
    assert.equal(check(Buffer.alloc(0), 'image/webp'), false)
  })

  test(`${name}: 다른 이미지 타입 판정은 그대로다`, () => {
    assert.equal(check(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg'), true)
    assert.equal(check(WEBP, 'image/jpeg'), false)
    assert.equal(
      check(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'),
      true
    )
    assert.equal(check(Buffer.from('GIF89a...'), 'image/gif'), true)
  })
}

test('hasValidFileSignature: WAVE는 audio/wav로만 통과한다', () => {
  assert.equal(hasValidFileSignature(WAVE, 'audio/wav'), true)
  assert.equal(hasValidFileSignature(WEBP, 'audio/wav'), false)
})

test('checkMagicBytes: 표에 없는 타입은 거부한다', () => {
  assert.equal(checkMagicBytes(WEBP, 'image/svg+xml'), false)
})
