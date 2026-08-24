import { MetadataRoute } from 'next'
import { getArtists, getProjects } from '@/lib/data'
import { getSiteUrl } from '@/utils/site'
import { listPosts } from '@/db/queries/posts'

// posts는 이제 Turso가 권위다. `listPosts`는 카테고리 단일값 필터(포함)만
// 지원하고 "잡담 제외"는 지원하지 않으므로, 카테고리 필터 없이 최신
// `updated_at` 순으로 최대 1000건을 가져온 뒤 잡담 제외·본문 길이 필터는
// 기존과 동일하게 메모리에서 적용한다. 회원 23명 규모에서 전체 게시글 수가
// 1000건을 넘을 가능성은 낮아, DB 레벨 제외 대신 메모리 필터로도 실질적으로
// 동일한 결과를 낸다(정확히 1000건 근처에서 "잡담이 상위를 차지해 결과가
// 1000건 미만이 되는" 이론적 경계 사례만 남는다 — 현재 규모에서는 무시 가능).
//
// `listPosts`는 `src/db/client.ts`의 지연 생성 Proxy를 통해 `TURSO_DATABASE_URL`
// 없이는 실제 쿼리 시점에 던진다(모듈 로드 자체는 안전) — 이 함수의 try/catch가
// 그 경우를 빈 배열로 흡수해 `next build`의 사이트맵 프리렌더가 죽지 않게 한다.
async function getBoardPostsForSitemap(): Promise<Array<{ id: string; updated_at: string }>> {
  try {
    // 색인 가치가 있는 게시글만 sitemap에 포함:
    // - 잡담 카테고리 제외 (개인적 단상 위주)
    // - 본문 길이 200자 이상 (thin content 방지)
    // page.tsx의 noindex 정책과 동기화하여 GSC 신호 일관성 확보.
    const { rows } = await listPosts({
      page: 1,
      limit: 1000,
      sort: 'updated_at_desc',
      includeDeleted: false,
    })

    return rows
      .filter(post => post.category !== '잡담')
      .filter(post => {
        const text = (post.content || '')
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
        return text.length >= 200
      })
      .map(({ id, updated_at }) => ({ id, updated_at }))
  } catch {
    return []
  }
}

type SitemapEntry = MetadataRoute.Sitemap[number]

function bilingualEntry(
  path: string,
  baseUrl: string,
  opts: Pick<SitemapEntry, 'lastModified' | 'changeFrequency' | 'priority'>
): SitemapEntry[] {
  const koUrl = path === '/' ? baseUrl : `${baseUrl}${path}`
  const enUrl = path === '/' ? `${baseUrl}/en` : `${baseUrl}/en${path}`
  const alternates = {
    languages: { 'ko-KR': koUrl, 'en-US': enUrl, 'x-default': koUrl },
  }
  return [
    { url: koUrl, ...opts, alternates },
    { url: enUrl, ...opts, alternates },
  ]
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteUrl()
  // 정적 페이지는 빌드 시점을 lastModified로 사용 — ISR 재빌드마다 갱신되어
  // 검색엔진에 최소한의 freshness 신호를 제공한다.
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    ...bilingualEntry('/', baseUrl, {
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    }),
    ...bilingualEntry('/about', baseUrl, {
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    }),
    ...bilingualEntry('/projects', baseUrl, {
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    }),
    ...bilingualEntry('/artists', baseUrl, {
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    }),
    ...bilingualEntry('/connect', baseUrl, {
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    }),
    ...bilingualEntry('/faq', baseUrl, {
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    }),
    ...bilingualEntry('/privacy', baseUrl, {
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    }),
    ...bilingualEntry('/terms', baseUrl, {
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    }),
    // board: 회원 전용 / noindex → ko만, alternates 없음
    { url: `${baseUrl}/board`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
  ]

  try {
    const [artists, projects, boardPosts] = await Promise.all([
      getArtists('ko'),
      getProjects('ko'),
      getBoardPostsForSitemap(),
    ])

    const artistPages: MetadataRoute.Sitemap = artists.flatMap(artist =>
      bilingualEntry(`/artists/${artist.slug}`, baseUrl, {
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
      })
    )

    const projectPages: MetadataRoute.Sitemap = projects.flatMap(project =>
      bilingualEntry(`/projects/${project.slug}`, baseUrl, {
        lastModified: new Date(project.publishedDate),
        changeFrequency: 'yearly',
        priority: 0.5,
      })
    )

    // board 게시글: ko만 (회원 전용 콘텐츠, en 버전 없음)
    const boardPostPages: MetadataRoute.Sitemap = boardPosts.map(post => ({
      url: `${baseUrl}/board/${post.id}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    }))

    return [...staticPages, ...artistPages, ...projectPages, ...boardPostPages]
  } catch (error) {
    console.error('Error generating sitemap:', error)
    return staticPages
  }
}
