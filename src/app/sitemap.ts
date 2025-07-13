import { MetadataRoute } from 'next'
import { getArtists, getProjects } from '@/lib/data'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://ggac.kr'
  const now = new Date()
  
  try {
    // 정적 페이지들
    const staticPages: MetadataRoute.Sitemap = [
      {
        url: baseUrl,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 1.0,
      },
      {
        url: `${baseUrl}/about`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.8,
      },
      {
        url: `${baseUrl}/archive`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/artists`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/connect`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.7,
      },
      {
        url: `${baseUrl}/board`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.6,
      },
    ]

    // 동적 아티스트 페이지들
    const artists = await getArtists()
    const artistPages: MetadataRoute.Sitemap = artists.map(artist => ({
      url: `${baseUrl}/artists/${artist.slug}`,
      lastModified: now, // 실제 환경에서는 아티스트 정보 수정일 사용
      changeFrequency: 'monthly',
      priority: 0.6,
    }))

    // 동적 프로젝트 페이지들
    const projects = await getProjects()
    const projectPages: MetadataRoute.Sitemap = projects.map(project => ({
      url: `${baseUrl}/archive/${project.slug}`,
      lastModified: new Date(project.publishedDate),
      changeFrequency: 'yearly',
      priority: 0.5,
    }))

    return [...staticPages, ...artistPages, ...projectPages]
  } catch (error) {
    console.error('Error generating sitemap:', error)
    
    // 에러 시 기본 정적 페이지만 반환
    return [
      {
        url: baseUrl,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 1.0,
      },
      {
        url: `${baseUrl}/about`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.8,
      },
      {
        url: `${baseUrl}/archive`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/artists`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/connect`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.7,
      },
    ]
  }
}