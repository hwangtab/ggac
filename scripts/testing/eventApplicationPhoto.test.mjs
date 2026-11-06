import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL = 'https://store.public.blob.vercel-storage.com'

const { isPrivateEventPhotoRef, publicEventPhotoPath } = await import(
  '../../src/lib/eventApplications/photo.ts'
)

const BASE = 'https://store.public.blob.vercel-storage.com'

/**
 * 행사·워크숍 신청 사진의 저장 참조 판정(2026-11-06 사각지대 점검).
 *
 * 지켜야 하는 성질:
 *  - 우리 공개 저장소의 `attachments/event-applications/` 아래만 "옮길 대상"으로 인정한다
 *    (남의 저장소·다른 접두를 옮기려 들면 안 된다).
 *  - 옮긴 뒤 저장되는 값은 **비공개 경로**이고, 절대 URL 은 옛 행으로 취급한다.
 *  - 경로에 `..` 가 섞이면 거부한다(저장소 밖을 가리키는 참조를 만들지 않는다).
 */
test('공개 사진 경로: 우리 저장소의 신청 사진 접두만 통과한다', () => {
  assert.equal(
    publicEventPhotoPath(`${BASE}/attachments/event-applications/event/x.png`),
    'attachments/event-applications/event/x.png'
  )
  const rejected = [
    'https://evil.example.com/attachments/event-applications/event/x.png',
    `${BASE}/attachments/posts/x.png`,
    `${BASE}/backups/2026-11-01.sql.gz`,
    `${BASE}/attachments/event-applications/../backups/x.sql`,
    'not a url',
    '',
  ]
  for (const url of rejected) assert.equal(publicEventPhotoPath(url), null, url)
})

test('비공개 참조: 경로만 참이고 절대 URL·상위 참조는 아니다', () => {
  assert.equal(isPrivateEventPhotoRef('event-applications/event/x.png'), true)
  for (const value of [
    `${BASE}/attachments/event-applications/event/x.png`,
    'https://evil.example.com/a.png',
    'event-applications/../backups/x.sql',
    '/event-applications/event/x.png',
    'attachments/event-applications/event/x.png',
    null,
    undefined,
    42,
  ]) {
    assert.equal(isPrivateEventPhotoRef(value), false, String(value))
  }
})
