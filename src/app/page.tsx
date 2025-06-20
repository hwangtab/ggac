import Hero from '@/components/Hero'
import FeaturedProjects from '@/components/FeaturedProjects'
import FeaturedArtists from '@/components/FeaturedArtists'
import fs from 'fs'
import path from 'path'

interface Project {
  id: string
  slug: string
  title: string
  category: string
  publishedDate: string
  coverImage: string
  description: string
  artistIds: string[]
}

interface Artist {
  id: string
  slug: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
}

export default function Home() {
  // 정적 데이터 로딩 (서버 컴포넌트에서)
  const projectsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
  ) as Project[]
  
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  // 최신 프로젝트 3개 (모든 프로젝트 표시)
  const featuredProjects = projectsData
    .sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime())
    .slice(0, 3)

  return (
    <div>
      <Hero />
      <FeaturedProjects projects={featuredProjects} />
      <FeaturedArtists artists={artistsData} />
    </div>
  )
}
