import artistsData from '../../../../../../data/artists.json'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const artists = artistsData as any[]
    const artist = artists.find(a => (a.slug || '').toLowerCase() === slug.toLowerCase())
    const target =
      artist && typeof artist.profileImage === 'string'
        ? artist.profileImage
        : '/images/logo/gac_og.webp'
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
