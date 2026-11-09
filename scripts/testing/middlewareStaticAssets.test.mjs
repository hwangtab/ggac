import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isStaticAssetPath, STATIC_ASSET_EXTENSIONS } from '../../src/middleware/static-assets.ts'

/**
 * 미들웨어 정적 자원 판정(2026-11-09 사각지대 점검).
 *
 * 예전 조건은 `pathname.includes('.')` 였다 — **점이 하나라도 있으면** 인증·CSP·intl 을 통째로
 * 건너뛰었다. 이 테스트가 지키는 성질:
 *  - 정적 자원(확장자·루트 파일·`/_next`)은 통과한다(오탐으로 인증을 태우면 정적 파일이 404/리다이렉트 된다).
 *  - **점이 있어도 모르는 확장자면 통과하지 않는다**(그게 원래의 구멍이었다).
 */

test('정적 자원: Next 내부 산출물·루트 파일·이미지·폰트·문서는 통과한다', () => {
  const pass = [
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    '/manifest.webmanifest',
    '/llms.txt',
    '/images/logo.webp',
    '/images/hero.avif',
    '/images/a.JPG',
    '/fonts/pretendard.woff2',
    '/uploads/report.pdf',
    '/uploads/회의자료.hwpx',
    '/uploads/plan.docx',
    '/uploads/sheet.xlsx',
    '/media/track.mp3',
    '/media/clip.mp4',
    '/data/seed.json',
  ]
  for (const pathname of pass) assert.equal(isStaticAssetPath(pathname), true, pathname)
})

test('정적 자원 아님: 점이 있어도 모르는 확장자·페이지 경로는 미들웨어를 탄다', () => {
  const blocked = [
    // 원래 구멍: 점이 있다는 이유로 인증·CSP 를 건너뛰던 경로들
    '/admin/grants/2026.11',
    '/ko/board-room/files/report.v2',
    '/board/hello.world',
    '/ko/mypage/documents/scan.2026',
    '/login/..',
    // 평범한 페이지 경로
    '/',
    '/ko/admin',
    '/api/health',
    '/board-room',
    // 확장자처럼 보이지만 목록에 없는 것
    '/uploads/archive.tar',
    '/uploads/note.md',
  ]
  for (const pathname of blocked) assert.equal(isStaticAssetPath(pathname), false, pathname)
})

test('판정은 경로 전체의 끝만 본다 — 중간에 점이 있는 디렉터리는 통과시키지 않는다', () => {
  assert.equal(isStaticAssetPath('/v1.2/images/logo'), false)
  assert.equal(isStaticAssetPath('/v1.2/images/logo.png'), true)
})

test('목록에 public/ 의 실제 확장자가 모두 들어 있다', () => {
  // public/ 에 있는 확장자(2026-11-09 확인) — 빠지면 그 파일은 미들웨어를 타 404/리다이렉트가 된다.
  for (const ext of [
    'webp',
    'jpg',
    'jpeg',
    'png',
    'svg',
    'ico',
    'avif',
    'js',
    'xlsx',
    'txt',
    'pptx',
    'hwpx',
    'docx',
  ]) {
    assert.ok(STATIC_ASSET_EXTENSIONS.includes(ext), `public/ 확장자 ${ext} 가 목록에 없다`)
  }
})
