import fs from 'fs'
import path from 'path'
import { cache } from 'react'
// Note: avoid React cache for artists to ensure tag-based revalidation works reliably

// 메모리 효율을 위한 고급 캐시 관리
interface CacheEntry<T> {
  data: T
  timestamp: number
  hits: number
}

/**
 * In-memory cache with TTL and simple LRU-style eviction.
 *
 * The cache stores up to `maxSize` entries. When an entry is older than
 * `maxAge` milliseconds it will be removed on access. If the cache exceeds
 * `maxSize`, the least frequently accessed entry is evicted.
 */
class MemoryEfficientCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize = 100 // 최대 캐시 항목 수
  private maxAge = 300000 // 5분 TTL

  /**
   * Retrieve a value from cache.
   * @param key - Cache key
   * @returns Cached value or `null` if missing/expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    // TTL 체크
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key)
      return null
    }

    // 히트 카운트 증가
    entry.hits++
    return entry.data
  }

  /**
   * Store data in the cache.
   * @param key - Cache key
   * @param data - Value to cache
   */
  set(key: string, data: T): void {
    // 캐시 크기 관리 - LRU 기반 제거
    if (this.cache.size >= this.maxSize) {
      this.evictLeastUsed()
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0,
    })
  }

  /** Remove the least frequently used entry from the cache. */
  private evictLeastUsed(): void {
    let leastUsedKey = ''
    let leastHits = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < leastHits) {
        leastHits = entry.hits
        leastUsedKey = key
      }
    }

    if (leastUsedKey) {
      this.cache.delete(leastUsedKey)
    }
  }

  /** Clear all cached entries. */
  clear(): void {
    this.cache.clear()
  }
}

// 전역 캐시 인스턴스 - 런타임에만 생성
let artistCache: MemoryEfficientCache<Artist[]> | null = null
let projectCache: MemoryEfficientCache<Project[]> | null = null
let legacyArtistMapPromise: Promise<Map<string, Artist>> | null = null

// 캐시 초기화 함수
function initCaches() {
  if (typeof window === 'undefined' && !artistCache) {
    artistCache = new MemoryEfficientCache<Artist[]>()
    projectCache = new MemoryEfficientCache<Project[]>()
  }
}

// 외부에서 아티스트 캐시를 무효화할 수 있도록 헬퍼를 노출
export function invalidateArtistsCache() {
  try {
    initCaches()
    artistCache?.clear()
    legacyArtistMapPromise = null
  } catch (e) {
    // 캐시 무효화 실패는 치명적이지 않음
    console.warn('invalidateArtistsCache failed:', e)
  }
}
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
    address: '',
  },
  social: {
    instagram: '',
    youtube: '',
  },
  businessInfo: {
    establishedDate: '2025-05-01',
    registrationDate: '2025-05-14',
    registrationNumber: '',
  },
}

// Supabase에서 전체 아티스트 목록 조회 (데이터베이스 우선, JSON 파일 백업)
export const getArtistsFromDB = async (): Promise<Artist[]> => {
  initCaches()

  // 고급 캐시에서 먼저 확인
  const cached = artistCache?.get('artists')
  if (cached) return cached
  try {
    // 환경 변수 체크 추가
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn('Supabase environment variables not available, falling back to JSON')
      const fallbackResult = await getArtistsFromJSON()
      artistCache?.set('artists', fallbackResult)
      return fallbackResult
    }

    // 정적 생성 시점에서도 접근 가능하도록 createClient 사용
    const { createClient } = await import('@supabase/supabase-js')
    // Attach Next.js cache tags so revalidateTag('artists') busts this cache across instances
    const revalidateValue = 3600
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            return fetch(input, {
              ...init,
              next: { revalidate: revalidateValue, tags: ['artists'] },
            })
          },
        },
      }
    )

    // 데이터베이스에서 아티스트 목록 조회 (public 접근 가능한 데이터만)
    const { data: dbArtists, error } = await supabase
      .from('artists')
      .select('*')
      .order('created_at', { ascending: true })

    if (!error && dbArtists && dbArtists.length > 0) {
      let result = dbArtists.map(convertDatabaseArtistToArtist)

      try {
        const legacyMap = await getLegacyArtistMap()
        result = result.map(artist => {
          const fallback = legacyMap.get(artist.slug) || legacyMap.get(artist.id)
          return applyProfileImageFallback(artist, fallback)
        })
      } catch (fallbackError) {
        console.warn('Failed to apply legacy artist image fallback:', fallbackError)
      }

      artistCache?.set('artists', result)
      return result
    }

    // 데이터베이스에 데이터가 없으면 JSON 파일에서 조회 (백업)
    const fallbackResult = await getArtistsFromJSON()
    artistCache?.set('artists', fallbackResult)
    return fallbackResult
  } catch (error) {
    console.error('Error fetching artists from database:', error)

    // 오류 발생 시 JSON 파일에서 조회 (백업)
    const errorFallbackResult = await getArtistsFromJSON()
    artistCache?.set('artists', errorFallbackResult)
    return errorFallbackResult
  }
}

// JSON 파일에서 아티스트 조회 (백업용)
export const getArtistsFromJSON = async (): Promise<Artist[]> => {
  try {
    const filePath = path.join(process.cwd(), 'data/artists.json')
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    console.error('Error loading artists data from JSON:', error)
    return []
  }
}

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtists = getArtistsFromDB

export const getProjects = cache(async (): Promise<Project[]> => {
  initCaches()

  // 고급 캐시에서 먼저 확인
  const cached = projectCache?.get('projects')
  if (cached) {
    return cached
  }

  try {
    const filePath = path.join(process.cwd(), 'data/projects.json')
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    const result = JSON.parse(fileContents)
    projectCache?.set('projects', result)
    return result
  } catch (error) {
    console.error('Error loading projects data:', error)
    const emptyResult: Project[] = []
    projectCache?.set('projects', emptyResult)
    return emptyResult
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

// ISR 최적화를 위한 revalidate 설정
export const revalidate = 86400 // 24시간 (전역 설정은 거의 변경되지 않음)

// DatabaseArtist를 Artist 타입으로 변환하는 함수
function convertDatabaseArtistToArtist(dbArtist: DatabaseArtist): Artist {
  return {
    id: dbArtist.legacy_id,
    slug: dbArtist.slug,
    name: dbArtist.name,
    category: dbArtist.category || [],
    profileImage:
      dbArtist.profile_photo_url ||
      dbArtist.profile_photo_metadata?.variant_urls?.webp ||
      dbArtist.profile_photo_metadata?.variant_urls?.fallback ||
      dbArtist.profile_photo_metadata?.variant_urls?.original ||
      '/images/default-avatar.webp',
    oneLiner: dbArtist.one_liner || '',
    bio: dbArtist.bio || '',
    templateType: dbArtist.template_type || '콜라주형',
    portfolioLinks: dbArtist.portfolio_links || [],
    youtubeVideos: dbArtist.youtube_videos || [],
    contact: dbArtist.contact || '',
  }
}

async function getLegacyArtistMap(): Promise<Map<string, Artist>> {
  if (!legacyArtistMapPromise) {
    legacyArtistMapPromise = (async () => {
      const legacyArtists = await getArtistsFromJSON()
      const map = new Map<string, Artist>()

      for (const artist of legacyArtists) {
        if (artist.id) {
          map.set(artist.id, artist)
        }
        if (artist.slug) {
          map.set(artist.slug, artist)
        }
      }

      return map
    })()
  }

  return legacyArtistMapPromise
}

function applyProfileImageFallback(artist: Artist, fallback?: Artist): Artist {
  if (!fallback?.profileImage) {
    return artist
  }

  const candidate = artist.profileImage?.trim()

  if (candidate && candidate !== '/images/default-avatar.webp') {
    return artist
  }

  return {
    ...artist,
    profileImage: fallback.profileImage,
  }
}

// Supabase에서 아티스트 조회 (데이터베이스 우선, JSON 파일 백업)
export const getArtistBySlugFromDB = async (slug: string): Promise<Artist | null> => {
  try {
    // 환경 변수 체크 추가
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn('Supabase environment variables not available, falling back to JSON')
      const artists = await getArtistsFromJSON()
      return artists.find(artist => artist.slug === slug) || null
    }

    // 정적 생성 시점에서도 접근 가능하도록 createClient 사용
    const { createClient } = await import('@supabase/supabase-js')
    const revalidateValue = 3600
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            return fetch(input, {
              ...init,
              next: { revalidate: revalidateValue, tags: ['artists'] },
            })
          },
        },
      }
    )

    // 데이터베이스에서 아티스트 조회
    const { data: dbArtist, error } = await supabase
      .from('artists')
      .select('*')
      .eq('slug', slug)
      .single()

    if (!error && dbArtist) {
      let convertedArtist = convertDatabaseArtistToArtist(dbArtist)

      try {
        const legacyMap = await getLegacyArtistMap()
        const fallback = legacyMap.get(convertedArtist.slug) || legacyMap.get(convertedArtist.id)
        convertedArtist = applyProfileImageFallback(convertedArtist, fallback)
      } catch (fallbackError) {
        console.warn('Failed to apply legacy artist image fallback:', fallbackError)
      }

      return convertedArtist
    }

    // 데이터베이스에 없으면 JSON 파일에서 조회 (백업)
    const artists = await getArtistsFromJSON()
    return artists.find(artist => artist.slug === slug) || null
  } catch (error) {
    console.error('Error fetching artist from database:', error)

    // 오류 발생 시 JSON 파일에서 조회 (백업)
    const artists = await getArtistsFromJSON()
    return artists.find(artist => artist.slug === slug) || null
  }
}

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtistBySlug = getArtistBySlugFromDB

export const getProjectBySlug = cache(async (slug: string): Promise<Project | null> => {
  const projects = await getProjects()
  return projects.find(project => project.slug === slug) || null
})

// 정렬된 프로젝트 가져오기 (최신순)
export const getProjectsSorted = cache(async (): Promise<Project[]> => {
  const projects = await getProjects()
  return [...projects].sort(
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
export const getArtistNamesById = cache(
  async (artistIds: string[]): Promise<Record<string, string>> => {
    const artists = await getArtistsFromDB()
    const nameMap: Record<string, string> = {}

    artistIds.forEach(id => {
      const artist = artists.find(a => a.id === id)
      if (artist) {
        nameMap[id] = artist.name
      }
    })

    return nameMap
  }
)

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
