import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)
process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL = 'https://store.public.blob.vercel-storage.com'
const { isOwnAudioUrl } = await import('../../src/utils/audioLink.ts')

test('우리 Blob 저장소의 음원만 플레이어가 된다', () => {
  assert.equal(
    isOwnAudioUrl('https://store.public.blob.vercel-storage.com/attachments/a/warlock.mp3'),
    true
  )
  assert.equal(
    isOwnAudioUrl('https://store.public.blob.vercel-storage.com/attachments/a/WARLOCK.M4A'),
    true
  )
})

test('남의 서버 음원, 음원이 아닌 파일, 이상한 값은 평범한 링크로 남는다', () => {
  assert.equal(isOwnAudioUrl('https://evil.example.com/warlock.mp3'), false)
  assert.equal(isOwnAudioUrl('https://other.public.blob.vercel-storage.com/warlock.mp3'), false)
  assert.equal(
    isOwnAudioUrl('https://store.public.blob.vercel-storage.com/attachments/a/cover.webp'),
    false
  )
  assert.equal(isOwnAudioUrl('https://store.public.blob.vercel-storage.com/a.mp3.html'), false)
  assert.equal(isOwnAudioUrl('javascript:alert(1)//.mp3'), false)
  assert.equal(isOwnAudioUrl(undefined), false)
})
