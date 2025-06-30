import fs from 'fs'
import path from 'path'
import { cache } from 'react'

// 타입 정의를 별도 파일로 분리할 수도 있지만, 여기서는 한 곳에 모아둠
export interface Artist {
  id: string
  slug: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
  bio: string
  templateType: string
  portfolioLinks: Array<{ title: string; url: string }>
  youtubeVideos?: Array<{ title: string; url: string }>
  contact: string
}

export interface Project {
  id: string
  slug: string
  title: string
  category: string
  publishedDate: string
  coverImage: string
  description: string
  gallery?: string[]
  videoUrl?: string | null
  artistIds: string[]
  ticketing?: Array<{
    platform: string
    url: string
    available: boolean
    price?: string
    startDate?: string
    endDate?: string
    soldOutDate?: string
  }>
}

export interface GlobalData {
  siteName: string
  siteDescription: string
  joinFormUrl: string
  supportFormUrl: string
  contact: {
    email: string
    phone: string
    address: string
  }
  social: {
    instagram: string
    youtube: string
  }
  businessInfo: {
    establishedDate: string
    registrationDate: string
    registrationNumber: string
  }
}

// 에러 처리를 위한 기본값들
const DEFAULT_GLOBAL_DATA: GlobalData = {
  siteName: '경기아트콜렉티브 협동조합',
  siteDescription: '경계 없는 상상, 함께 만드는 울림',
  joinFormUrl: '',
  supportFormUrl: '',
  contact: {
    email: 'contact@ggac.kr',
    phone: '',
    address: ''
  },
  social: {
    instagram: '',
    youtube: ''
  },
  businessInfo: {
    establishedDate: '2025-05-01',
    registrationDate: '2025-05-14',
    registrationNumber: ''
  }
}

// React cache를 사용한 비동기 데이터 로딩 함수들 (권장)
export const getArtists = cache(async (): Promise<Artist[]> => {
  try {
    const filePath = path.join(process.cwd(), 'data/artists.json')
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading artists data:', error)
    return []
  }
})

export const getProjects = cache(async (): Promise<Project[]> => {
  try {
    const filePath = path.join(process.cwd(), 'data/projects.json')
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading projects data:', error)
    return []
  }
})

export const getGlobalData = cache(async (): Promise<GlobalData> => {
  try {
    const filePath = path.join(process.cwd(), 'data/global.json')
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading global data:', error)
    return DEFAULT_GLOBAL_DATA
  }
})

// 개별 아이템 조회 함수들
export const getArtistBySlug = cache(async (slug: string): Promise<Artist | null> => {
  const artists = await getArtists()
  return artists.find(artist => artist.slug === slug) || null
})

export const getProjectBySlug = cache(async (slug: string): Promise<Project | null> => {
  const projects = await getProjects()
  return projects.find(project => project.slug === slug) || null
})

// 정렬된 프로젝트 가져오기 (최신순)
export const getProjectsSorted = cache(async (): Promise<Project[]> => {
  const projects = await getProjects()
  return projects.sort(
    (a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime()
  )
})

// 특정 프로젝트들 가져오기 (홈페이지용)
export const getFeaturedProjects = cache(async (limit: number = 3): Promise<Project[]> => {
  const sortedProjects = await getProjectsSorted()
  return sortedProjects.slice(0, limit)
})

// generateStaticParams를 위한 slug 배열 생성 함수들
export const getArtistSlugs = cache(async (): Promise<string[]> => {
  const artists = await getArtists()
  return artists.map(artist => artist.slug)
})

export const getProjectSlugs = cache(async (): Promise<string[]> => {
  const projects = await getProjects()
  return projects.map(project => project.slug)
})

// 아티스트 이름 매핑 (프로젝트에서 아티스트 이름 표시용)
export const getArtistNamesById = cache(async (artistIds: string[]): Promise<Record<string, string>> => {
  const artists = await getArtists()
  const nameMap: Record<string, string> = {}
  
  artistIds.forEach(id => {
    const artist = artists.find(a => a.id === id)
    if (artist) {
      nameMap[id] = artist.name
    }
  })
  
  return nameMap
})

// 프로젝트에 참여한 아티스트들 정보 가져오기
export const getProjectArtists = cache(async (artistIds: string[]): Promise<Artist[]> => {
  const artists = await getArtists()
  return artists.filter(artist => artistIds.includes(artist.id))
})

// 동기 버전 (기존 코드와의 호환성을 위해 유지, 하지만 사용 지양)
// 주로 API Route나 특별한 경우에만 사용
export const getArtistsSync = (): Artist[] => {
  try {
    const filePath = path.join(process.cwd(), 'data/artists.json')
    const fileContents = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading artists data (sync):', error)
    return []
  }
}

export const getProjectsSync = (): Project[] => {
  try {
    const filePath = path.join(process.cwd(), 'data/projects.json')
    const fileContents = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading projects data (sync):', error)
    return []
  }
}

export const getGlobalDataSync = (): GlobalData => {
  try {
    const filePath = path.join(process.cwd(), 'data/global.json')
    const fileContents = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading global data (sync):', error)
    return DEFAULT_GLOBAL_DATA
  }
}
