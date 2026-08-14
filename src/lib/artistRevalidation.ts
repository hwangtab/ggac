/**
 * 아티스트 프로필/사진 변경 시 Next.js 전체 라우트 캐시(Full Route Cache)에서
 * 무효화해야 하는 실제 렌더 경로 목록을 계산한다.
 *
 * 배경: `next-intl`의 `localePrefix: 'as-needed'` 설정 때문에 기본 로케일(ko)은
 * 사용자에게 보이는 URL에 접두사가 없다(`/artists`). 그러나 `src/middleware.ts`의
 * next-intl 미들웨어는 그 요청을 **내부적으로 `/ko/artists`로 rewrite**해서
 * `[locale]` 세그먼트에 매칭시킨다 — 이 rewrite 후의 경로가 렌더 시점의
 * `url.pathname`이 되고, `revalidatePath`가 매칭하는 캐시 태그도 이 값을 기준으로
 * 만들어진다(`next/dist/server/lib/implicit-tags.js`의 `getImplicitTags`, Next.js
 * 15.5 기준 실측 확인). 즉 `revalidatePath('/artists')`(접두사 없이)는 ko 페이지에
 * **매칭되지 않는다** — 반드시 `revalidatePath('/ko/artists')`를 호출해야 한다.
 * en은 애초에 URL 접두사가 `/en`이라 내부 rewrite 경로와 외부 경로가 같으므로
 * `/en/...`이 그대로 맞는다.
 *
 * (`GET /ko/artists`가 실제로는 307로 `/artists`에 리다이렉트되는 것은 별개의
 * 얘기다 — 그건 브라우저가 그 URL로 "직접 이동"했을 때의 정규화 동작이고,
 * `revalidatePath`는 HTTP 요청을 만들지 않고 캐시 태그 저장소를 직접 조작하므로
 * 이 리다이렉트와 무관하게 렌더 시 실제로 쓰인 내부 경로(`/ko/...`)로 호출해야
 * 한다.)
 *
 * `revalidatePath(path)`(type 인자 없이 호출)는 렌더된 페이지의 "실제 요청 경로
 * (rewrite 이후 url.pathname)"에서 파생된 태그 하나에만 정확히 일치한다 —
 * 라우트 패턴(`/[locale]/artists`)이 아니라 로케일이 이미 대입된 구체 경로여야
 * 매칭된다. 따라서 로케일마다 별도로 호출해야 두 로케일 모두 무효화되며, 이는
 * 게시판(board) 라우트(`src/app/api/posts/route.ts`)가 이미 쓰고 있는 방식과
 * 같은 원리다(다만 board는 ko 기본 페이지의 실제 내부 rewrite 경로를 쓰지 않고
 * `/board`를 그대로 쓰고 있어 board 쪽도 같은 함정을 안고 있을 수 있다 —
 * 이번 수정 범위 밖이라 별도로 보고한다).
 *
 * 이 파일의 함수들은 부수효과 없이 "무효화할 경로 목록"만 계산하는 순수 함수다.
 * 실제 `revalidatePath` 호출은 호출부(API 라우트)에서 이 목록을 순회하며 수행한다.
 */

/** ko(기본 로케일)의 내부 rewrite 경로 접두사, en의 URL 접두사. */
const LOCALE_PREFIXES = ['/ko', '/en'] as const

function localizedPath(prefix: string, path: string): string {
  return path === '/' ? prefix : `${prefix}${path}`
}

function withLocales(paths: string[]): string[] {
  return LOCALE_PREFIXES.flatMap(prefix => paths.map(path => localizedPath(prefix, path)))
}

/**
 * 아티스트 프로필(이름/소개/약력/사진 등) 변경 시 무효화할 핵심 경로.
 * 홈(피처드 아티스트 섹션)과 아티스트 목록은 항상 포함하고, slug가 주어지면
 * 해당 아티스트 상세 페이지도 포함한다.
 *
 * 반환 예시(slug='foo'):
 * ['/ko', '/ko/artists', '/ko/artists/foo', '/en', '/en/artists', '/en/artists/foo']
 */
export function getArtistCoreRevalidationPaths(slug?: string | null): string[] {
  const routes = ['/', '/artists']
  if (slug) {
    routes.push(`/artists/${slug}`)
  }
  return withLocales(routes)
}

/** 아카이브 목록 페이지 무효화 경로. */
export function getArchiveListRevalidationPaths(): string[] {
  return withLocales(['/archive'])
}

/**
 * 아티스트가 참여한 특정 아카이브 프로젝트 상세 페이지 무효화 경로.
 * 프로젝트 slug 하나에 대해 두 로케일 경로를 모두 반환한다.
 */
export function getArchiveProjectRevalidationPaths(projectSlug: string): string[] {
  return withLocales([`/archive/${projectSlug}`])
}
