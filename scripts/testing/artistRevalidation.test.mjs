import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  getArtistCoreRevalidationPaths,
  getArchiveListRevalidationPaths,
  getArchiveProjectRevalidationPaths,
} = await import('../../src/lib/artistRevalidation.ts')

// ko(기본 로케일)는 사용자에게 보이는 URL에 접두사가 없지만, next-intl 미들웨어가
// 요청을 내부적으로 `/ko/...`로 rewrite하기 때문에 revalidatePath가 매칭하는 캐시
// 태그는 `/ko` 접두사 기준으로 만들어진다(실측: production build + next start에서
// revalidatePath('/artists')는 ko 페이지를 무효화하지 못하고 revalidatePath('/ko/artists')만
// 무효화함을 확인). 그래서 아래 기대값은 항상 '/ko' 접두사를 포함한다.

test('아티스트 핵심 경로: slug가 있으면 홈·목록·상세를 두 로케일 모두 반환', () => {
  const paths = getArtistCoreRevalidationPaths('gilbert')
  assert.deepEqual(paths, [
    '/ko',
    '/ko/artists',
    '/ko/artists/gilbert',
    '/en',
    '/en/artists',
    '/en/artists/gilbert',
  ])
})

test('아티스트 핵심 경로: slug가 없으면 홈·목록만 두 로케일 모두 반환', () => {
  const paths = getArtistCoreRevalidationPaths(undefined)
  assert.deepEqual(paths, ['/ko', '/ko/artists', '/en', '/en/artists'])
})

test('아티스트 핵심 경로: slug가 null/빈 문자열이면 상세 경로 제외', () => {
  assert.deepEqual(getArtistCoreRevalidationPaths(null), [
    '/ko',
    '/ko/artists',
    '/en',
    '/en/artists',
  ])
  assert.deepEqual(getArtistCoreRevalidationPaths(''), ['/ko', '/ko/artists', '/en', '/en/artists'])
})

test('아카이브 목록 경로: 두 로케일 모두 반환하고 트레일링 슬래시 없음', () => {
  assert.deepEqual(getArchiveListRevalidationPaths(), ['/ko/archive', '/en/archive'])
})

test('아카이브 프로젝트 상세 경로: 두 로케일 모두 반환', () => {
  assert.deepEqual(getArchiveProjectRevalidationPaths('project-1'), [
    '/ko/archive/project-1',
    '/en/archive/project-1',
  ])
})

test('홈 경로는 로케일 접두사만 붙고 이중 슬래시가 생기지 않음', () => {
  const paths = getArtistCoreRevalidationPaths()
  assert.ok(paths.includes('/ko'))
  assert.ok(paths.includes('/en'))
  assert.ok(!paths.includes('/ko/'))
  assert.ok(!paths.includes('/en/'))
})
