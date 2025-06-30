import ArchiveContent from './ArchiveContent'
import { getProjectsSorted, getArtists } from '@/lib/data'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '프로젝트 | 경기아트콜렉티브 협동조합',
  description: '우리가 만들어가는 프로젝트들',
}

const ArchivePage = async () => {
  // 개선된 데이터 로딩 - 중복 제거 및 캐싱 활용
  const projects = await getProjectsSorted() // 이미 정렬된 프로젝트들
  const artists = await getArtists()

  return <ArchiveContent projects={projects} artists={artists} />
}

export default ArchivePage
