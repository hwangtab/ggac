import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

const {
  sweepAbandonedEventPhotos,
  isSweepableEventPhotoPath,
  AbandonedPhotoSweepAbortedError,
  ABANDONED_PHOTO_PREFIX,
  ABANDONED_MIN_AGE_MS,
  ABANDONED_MAX_REMOVALS,
  ABANDONED_BREAKER_MIN,
} = await import('../../src/lib/eventApplications/abandonedUploads.ts')

/**
 * 제출되지 않은 행사 신청 사진 정리(2026-11-09).
 *
 * 지켜야 하는 성질:
 *  - **48시간 지난 것만** 지운다(폼 작성 중인 사람의 사진을 지우지 않는다).
 *  - **어떤 신청도 가리키지 않는 것만** 지운다.
 *  - 접두 밖 경로(게시글 첨부·아티스트 사진)는 목록에 섞여 있어도 건드리지 않는다.
 *  - 미참조가 비정상적으로 많으면(차단기) **하나도 지우지 않고** 멈춘다.
 */

const NOW = new Date('2026-11-09T12:00:00Z')
const OLD = new Date(NOW.getTime() - ABANDONED_MIN_AGE_MS - 60_000)
const FRESH = new Date(NOW.getTime() - 1_000)

function deps({ objects, referenced = [], removeImpl } = {}) {
  const removed = []
  return {
    removed,
    list: async () => objects,
    findReferenced: async () => new Set(referenced),
    remove:
      removeImpl ??
      (async paths => {
        removed.push(...paths)
      }),
    now: () => NOW,
  }
}

const p = name => `${ABANDONED_PHOTO_PREFIX}${name}`

test('오래되고 아무 신청도 가리키지 않는 사진만 지운다', async () => {
  const d = deps({
    objects: [
      { pathname: p('a/keep.jpg'), uploadedAt: OLD }, // 참조됨
      { pathname: p('a/abandoned.jpg'), uploadedAt: OLD }, // 미참조 → 지운다
      { pathname: p('a/fresh.jpg'), uploadedAt: FRESH }, // 48시간 안 → 남긴다
      { pathname: 'attachments/posts/x.png', uploadedAt: OLD }, // 접두 밖 → 남긴다
      { pathname: 'user-profile/y.png', uploadedAt: OLD }, // 접두 밖 → 남긴다
    ],
    referenced: [p('a/keep.jpg')],
  })
  const out = await sweepAbandonedEventPhotos(d)
  assert.deepEqual(d.removed, [p('a/abandoned.jpg')])
  assert.equal(out.removed, 1)
  assert.equal(out.capped, false)
})

test('올라온 시각이 이상한 값이면 건드리지 않는다', async () => {
  const d = deps({
    objects: [{ pathname: p('a/bad.jpg'), uploadedAt: new Date(Number.NaN) }],
  })
  const out = await sweepAbandonedEventPhotos(d)
  assert.deepEqual(d.removed, [])
  assert.equal(out.removed, 0)
})

test('미참조가 차단기를 넘으면 하나도 지우지 않고 멈춘다', async () => {
  const objects = Array.from({ length: ABANDONED_BREAKER_MIN + 10 }, (_, i) => ({
    pathname: p(`bulk/${i}.jpg`),
    uploadedAt: OLD,
  }))
  const d = deps({ objects })
  await assert.rejects(
    () => sweepAbandonedEventPhotos(d),
    error => error instanceof AbandonedPhotoSweepAbortedError
  )
  assert.deepEqual(d.removed, [], '멈췄는데 지운 것이 있다')
})

test('한 번에 지우는 수에 상한이 있고 남으면 capped로 알린다', async () => {
  // 차단기(절반 초과)에 걸리지 않게 참조된 것을 함께 둔다.
  const objects = [
    ...Array.from({ length: ABANDONED_MAX_REMOVALS + 20 }, (_, i) => ({
      pathname: p(`many/${i}.jpg`),
      uploadedAt: OLD,
    })),
    ...Array.from({ length: ABANDONED_MAX_REMOVALS + 20 }, (_, i) => ({
      pathname: p(`keep/${i}.jpg`),
      uploadedAt: OLD,
    })),
  ]
  const referenced = objects.filter(o => o.pathname.includes('/keep/')).map(o => o.pathname)
  const d = deps({ objects, referenced })
  const out = await sweepAbandonedEventPhotos(d)
  assert.equal(out.removed, ABANDONED_MAX_REMOVALS)
  assert.equal(out.capped, true)
  assert.equal(d.removed.length, ABANDONED_MAX_REMOVALS)
})

test('접두·상위참조 판정', () => {
  assert.equal(isSweepableEventPhotoPath(p('a/b.jpg')), true)
  assert.equal(isSweepableEventPhotoPath('attachments/posts/a.jpg'), false)
  assert.equal(isSweepableEventPhotoPath(`${ABANDONED_PHOTO_PREFIX}../backups/x.sql`), false)
  assert.equal(isSweepableEventPhotoPath(''), false)
})
