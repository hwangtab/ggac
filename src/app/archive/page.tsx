import fs from 'fs'
import path from 'path'
import ArchiveContent from './ArchiveContent'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '프로젝트 | 경기아트콜렉티브 협동조합',
  description: '우리가 만들어가는 프로젝트들',
}

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
  name: string
}

const ArchivePage = async () => {
  // 정적 데이터 로딩
  const projectsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
  ) as Project[]
  
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  // 최신순으로 정렬
  const sortedProjects = projectsData.sort(
    (a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime()
  )

  return <ArchiveContent projects={sortedProjects} artists={artistsData} />
}

export default ArchivePage
