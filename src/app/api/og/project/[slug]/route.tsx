import projectsData from '../../../../../../data/projects.json'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'
export const preferredRegion = 'icn1'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const projects = projectsData as any[]
    const project = projects.find(p => (p.slug || '').toLowerCase() === slug.toLowerCase())
    let target = '/images/logo/gac_og.webp'
    if (project) {
      if (typeof project.coverImage === 'string' && project.coverImage) target = project.coverImage
      else if (Array.isArray(project.gallery) && project.gallery.length > 0)
        target = project.gallery[0]
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/images/logo/gac_og.webp',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
}
