import fs from 'fs'
import path from 'path'
import { cache } from 'react'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

// 중앙화된 타입 시스템에서 임포트
import type { Artist, Project, GlobalData, DatabaseArtist } from '@/types'

// 타입을 re-export하여 다른 파일에서 사용 가능하게 함
export type { Artist, Project, GlobalData } from '@/types'

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

// Supabase에서 전체 아티스트 목록 조회 (데이터베이스 우선, JSON 파일 백업)
export const getArtistsFromDB = cache(async (): Promise<Artist[]> => {
  try {
    // 정적 생성 시점에서도 접근 가능하도록 createClient 사용
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    
    // 데이터베이스에서 아티스트 목록 조회 (public 접근 가능한 데이터만)
    const { data: dbArtists, error } = await supabase
      .from('artists')
      .select('*')
      .order('created_at', { ascending: true })
    
    if (!error && dbArtists && dbArtists.length > 0) {
      return dbArtists.map(convertDatabaseArtistToArtist)
    }
    
    // 데이터베이스에 데이터가 없으면 JSON 파일에서 조회 (백업)
    console.log('No artists found in database, falling back to JSON')
    return await getArtistsFromJSON()
    
  } catch (error) {
    console.error('Error fetching artists from database:', error)
    
    // 오류 발생 시 JSON 파일에서 조회 (백업)
    return await getArtistsFromJSON()
  }
})

// JSON 파일에서 아티스트 조회 (백업용)
export const getArtistsFromJSON = cache(async (): Promise<Artist[]> => {
  try {
    const filePath = path.join(process.cwd(), 'data/artists.json')
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading artists data from JSON:', error)
    return []
  }
})

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtists = getArtistsFromDB

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

// DatabaseArtist를 Artist 타입으로 변환하는 함수
function convertDatabaseArtistToArtist(dbArtist: DatabaseArtist): Artist {
  return {
    id: dbArtist.legacy_id,
    slug: dbArtist.slug,
    name: dbArtist.name,
    category: dbArtist.category || [],
    profileImage: dbArtist.profile_photo_url || dbArtist.profile_image || '',
    oneLiner: dbArtist.one_liner || '',
    bio: dbArtist.bio || '',
    templateType: dbArtist.template_type || '콜라주형',
    portfolioLinks: dbArtist.portfolio_links || [],
    youtubeVideos: dbArtist.youtube_videos || [],
    contact: dbArtist.contact || ''
  }
}

// Supabase에서 아티스트 조회 (데이터베이스 우선, JSON 파일 백업)
export const getArtistBySlugFromDB = cache(async (slug: string): Promise<Artist | null> => {
  try {
    // 정적 생성 시점에서도 접근 가능하도록 createClient 사용
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    
    // 데이터베이스에서 아티스트 조회
    const { data: dbArtist, error } = await supabase
      .from('artists')
      .select('*')
      .eq('slug', slug)
      .single()
    
    if (!error && dbArtist) {
      return convertDatabaseArtistToArtist(dbArtist)
    }
    
    // 데이터베이스에 없으면 JSON 파일에서 조회 (백업)
    console.log(`Artist ${slug} not found in database, falling back to JSON`)
    const artists = await getArtistsFromJSON()
    return artists.find(artist => artist.slug === slug) || null
    
  } catch (error) {
    console.error('Error fetching artist from database:', error)
    
    // 오류 발생 시 JSON 파일에서 조회 (백업)
    const artists = await getArtistsFromJSON()
    return artists.find(artist => artist.slug === slug) || null
  }
})

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtistBySlug = getArtistBySlugFromDB

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
  const artists = await getArtistsFromDB()
  return artists.map(artist => artist.slug)
})

export const getProjectSlugs = cache(async (): Promise<string[]> => {
  const projects = await getProjects()
  return projects.map(project => project.slug)
})

// 아티스트 이름 매핑 (프로젝트에서 아티스트 이름 표시용)
export const getArtistNamesById = cache(async (artistIds: string[]): Promise<Record<string, string>> => {
  const artists = await getArtistsFromDB()
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
  const artists = await getArtistsFromDB()
  return artists.filter(artist => artistIds.includes(artist.id))
})

// 특정 아티스트가 참여한 프로젝트들 조회 (최신순 정렬)
export const getArtistProjects = cache(async (artistId: string): Promise<Project[]> => {
  const projects = await getProjects()
  return projects
    .filter(project => project.artistIds.includes(artistId))
    .sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime())
})

