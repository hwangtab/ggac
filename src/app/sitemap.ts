import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getArtists, getProjects } from '@/lib/data'
import { getSiteUrl } from '@/utils/site'

async function getBoardPostsForSitemap(): Promise<Array<{ id: string; updated_at: string }>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []

  try {
    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // 색인 가치가 있는 게시글만 sitemap에 포함:
    // - 잡담 카테고리 제외 (개인적 단상 위주)
    // - 본문 길이 200자 이상 (thin content 방지)
    // page.tsx의 noindex 정책과 동기화하여 GSC 신호 일관성 확보.
    const { data, error } = await supabase
      .from('posts')
      .select('id, updated_at, content, category')
      .eq('is_deleted', false)
      .neq('category', '잡담')
      .order('updated_at', { ascending: false })
      .limit(1000)

    if (error || !data) return []
    return data
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
    ...bilingualEntry('/', baseUrl, { lastModified: now, changeFrequency: 'weekly', priority: 1.0 }),
    ...bilingualEntry('/about', baseUrl, { lastModified: now, changeFrequency: 'monthly', priority: 0.8 }),
    ...bilingualEntry('/archive', baseUrl, { lastModified: now, changeFrequency: 'weekly', priority: 0.9 }),
    ...bilingualEntry('/artists', baseUrl, { lastModified: now, changeFrequency: 'weekly', priority: 0.9 }),
    ...bilingualEntry('/connect', baseUrl, { lastModified: now, changeFrequency: 'monthly', priority: 0.7 }),
    ...bilingualEntry('/faq', baseUrl, { lastModified: now, changeFrequency: 'monthly', priority: 0.7 }),
    ...bilingualEntry('/privacy', baseUrl, { lastModified: now, changeFrequency: 'monthly', priority: 0.5 }),
    ...bilingualEntry('/terms', baseUrl, { lastModified: now, changeFrequency: 'monthly', priority: 0.5 }),
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
      bilingualEntry(`/archive/${project.slug}`, baseUrl, {
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
