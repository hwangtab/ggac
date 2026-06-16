import projectsData from '../../../../../../data/projects.json'
import { toSafeInternalImagePath } from '@/utils/safeUrl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const projects = projectsData as any[]
    const project = projects.find(p => (p.slug || '').toLowerCase() === slug.toLowerCase())
    let safeTarget = '/images/logo/gac_og.webp'
    if (project) {
      safeTarget = toSafeInternalImagePath(project.coverImage)
      if (
        safeTarget === '/images/logo/gac_og.webp' &&
        Array.isArray(project.gallery) &&
        project.gallery.length > 0
      ) {
        safeTarget = toSafeInternalImagePath(project.gallery[0])
      }
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: safeTarget,
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
