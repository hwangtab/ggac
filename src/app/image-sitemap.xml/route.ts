import { NextResponse } from 'next/server'
import { getArtists, getProjects } from '@/lib/data'
import { getSiteUrl } from '@/utils/site'
import { generateImageUrl } from '@/utils/imageUrl'

export const revalidate = 43200 // 12시간

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const baseUrl = getSiteUrl()

  try {
    const [artists, projects] = await Promise.all([getArtists(), getProjects()])

    const entries: string[] = []

    // 프로젝트 이미지
    for (const project of projects) {
      const images: string[] = []

      if (project.coverImage) {
        const url = generateImageUrl(project.coverImage, { absolute: true })
        if (url) images.push(url)
      }

      if (Array.isArray(project.gallery)) {
        for (const img of project.gallery.slice(0, 5)) {
          const url = generateImageUrl(img, { absolute: true })
          if (url && !images.includes(url)) images.push(url)
        }
      }

      if (images.length === 0) continue

      const imageXml = images
        .map(
          imgUrl => `    <image:image>
      <image:loc>${escapeXml(imgUrl)}</image:loc>
      <image:title>${escapeXml(project.title)}</image:title>
    </image:image>`
        )
        .join('\n')

      entries.push(`  <url>
    <loc>${escapeXml(`${baseUrl}/projects/${project.slug}`)}</loc>
${imageXml}
  </url>`)
    }

    // 아티스트 프로필 이미지
    for (const artist of artists) {
      const profileUrl = artist.profileImage
      if (!profileUrl) continue

      const imgUrl = generateImageUrl(profileUrl, { absolute: true })
      if (!imgUrl) continue

      entries.push(`  <url>
    <loc>${escapeXml(`${baseUrl}/artists/${artist.slug}`)}</loc>
    <image:image>
      <image:loc>${escapeXml(imgUrl)}</image:loc>
      <image:title>${escapeXml(artist.name)}</image:title>
    </image:image>
  </url>`)
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
>
${entries.join('\n')}
</urlset>`

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=43200, stale-while-revalidate=3600',
      },
    })
  } catch (error) {
    console.error('Error generating image sitemap:', error)
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"></urlset>`,
      { headers: { 'Content-Type': 'application/xml' } }
    )
  }
}
