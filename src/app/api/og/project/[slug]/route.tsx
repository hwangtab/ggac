interface Project {
  id: string
  slug: string
  title: string
  category: string
  publishedDate: string
  coverImage: string
  description: string
  gallery: string[] | null
  videoUrl: string | null
  artistIds: string[]
}

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { slug: string } }
) {
  try {
    // 서버 사이드에서 파일 시스템 접근
    const fs = await import('fs')
    const path = await import('path')
    
    const projectsData = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
    ) as Project[]
    
    const project = projectsData.find(p => 
      p.slug.toLowerCase() === params.slug.toLowerCase()
    )

    if (!project) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/images/logo/gac_og.webp',
          'Cache-Control': 'public, max-age=86400'
        }
      })
    }

    // 이미지 URL 결정 (JPG 우선 사용)
    const getJpgPath = (imagePath: string) => imagePath.replace('.webp', '.jpg')
    
    let targetImage = '/images/logo/gac_og.jpg'
    
    // 1. coverImage 우선
    if (project.coverImage) {
      targetImage = getJpgPath(project.coverImage)
    } 
    // 2. 갤러리 첫 번째 이미지
    else if (project.gallery && project.gallery.length > 0) {
      targetImage = getJpgPath(project.gallery[0])
    }

    return new Response(null, {
      status: 302,
      headers: {
        'Location': targetImage,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Error in project OG API:', error)
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/images/logo/gac_og.webp',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
}