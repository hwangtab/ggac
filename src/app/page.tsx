import Hero from '@/components/Hero'
import FeaturedProjects from '@/components/FeaturedProjects'
import FeaturedArtists from '@/components/FeaturedArtists'
import { getFeaturedProjects, getArtists } from '@/lib/data'

export default async function Home() {
  // 개선된 데이터 로딩 - 캐싱된 함수 사용
  const featuredProjects = await getFeaturedProjects(3) // 최신 3개 프로젝트
  const artists = await getArtists()

  return (
    <div>
      <Hero />
      <FeaturedProjects projects={featuredProjects} />
      <FeaturedArtists artists={artists} />
    </div>
  )
}
