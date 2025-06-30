import ArtistsContent from './ArtistsContent'
import { getArtists } from '@/lib/data'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '함께하는 사람들 | 경기아트콜렉티브 협동조합',
  description: '서로의 우주가 되어',
}

const ArtistsPage = async () => {
  // 개선된 데이터 로딩 - 타입까지 포함된 캐싱 함수 사용
  const artists = await getArtists()

  return <ArtistsContent artists={artists} />
}

export default ArtistsPage
