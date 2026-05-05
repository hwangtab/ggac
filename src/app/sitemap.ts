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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteUrl()

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/about`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/archive`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/artists`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/connect`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/board`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${baseUrl}/privacy`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/terms`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/faq`, changeFrequency: 'monthly', priority: 0.7 },
  ]

  try {
    const [artists, projects, boardPosts] = await Promise.all([
      getArtists(),
      getProjects(),
      getBoardPostsForSitemap(),
    ])

    const artistPages: MetadataRoute.Sitemap = artists.map(artist => ({
      url: `${baseUrl}/artists/${artist.slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    }))

    const projectPages: MetadataRoute.Sitemap = projects.map(project => ({
      url: `${baseUrl}/archive/${project.slug}`,
      lastModified: new Date(project.publishedDate),
      changeFrequency: 'yearly',
      priority: 0.5,
    }))

    const boardPostPages: MetadataRoute.Sitemap = boardPosts.map(post => ({
      url: `${baseUrl}/board/${post.id}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: 'monthly',
      priority: 0.4,
    }))

    return [...staticPages, ...artistPages, ...projectPages, ...boardPostPages]
  } catch (error) {
    console.error('Error generating sitemap:', error)
    return staticPages
  }
}
