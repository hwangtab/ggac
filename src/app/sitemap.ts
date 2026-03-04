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
    const { data, error } = await supabase
      .from('posts')
      .select('id, updated_at')
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
      .limit(500)

    if (error || !data) return []
    return data
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
