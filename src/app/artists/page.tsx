import fs from 'fs'
import path from 'path'
import ArtistsContent from './ArtistsContent'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '함께하는 사람들 | 경기아트콜렉티브 협동조합',
  description: '서로의 우주가 되어',
}

interface Artist {
  id: string
  slug: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
  bio: string
  templateType: string
  portfolioLinks: Array<{ title: string; url: string }>
  contact: string
}

const ArtistsPage = async () => {
  // 정적 데이터 로딩
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  return <ArtistsContent artists={artistsData} />
}

export default ArtistsPage
