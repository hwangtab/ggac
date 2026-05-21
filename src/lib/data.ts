import fs from 'fs'
import path from 'path'
import { cache } from 'react'
import { createLogger } from '@/utils/logger'

const log = createLogger('data')
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
let enArtistTextMapPromise: Promise<Map<string, Artist>> | null = null

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
    enArtistTextMapPromise = null
  } catch (e) {
    // 캐시 무효화 실패는 치명적이지 않음
    log.warn('invalidateArtistsCache failed', e)
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
// locale은 DB 없이 JSON 폴백 경로에서만 적용됨 (DB _en 컬럼은 Phase 5에서 추가)
export const getArtistsFromDB = async (locale = 'ko'): Promise<Artist[]> => {
  initCaches()

  // 고급 캐시에서 먼저 확인
  const cacheKey = `artists:${locale}`
  const cached = artistCache?.get(cacheKey)
  if (cached) return cached
  try {
    // 환경 변수 체크 추가
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      log.warn('Supabase environment variables not available, falling back to JSON')
      const fallbackResult = await getArtistsFromJSON(locale)
      artistCache?.set(cacheKey, fallbackResult)
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
      let result = dbArtists.map(a => convertDatabaseArtistToArtist(a, locale))

      try {
        const legacyMap = await getLegacyArtistMap()
        result = result.map(artist => {
          const fallback = legacyMap.get(artist.slug) || legacyMap.get(artist.id)
          return applyProfileImageFallback(artist, fallback)
        })
      } catch (fallbackError) {
        log.warn('Failed to apply legacy artist image fallback:', fallbackError)
      }

      if (locale === 'en') {
        try {
          const enMap = await buildEnArtistTextMap()
          result = result.map(a => overlayEnglishArtistText(a, enMap.get(a.slug) ?? enMap.get(a.id)))
        } catch (enError) {
          log.warn('Failed to apply English text overlay:', enError)
        }
      }

      artistCache?.set(cacheKey, result)
      return result
    }

    // 데이터베이스에 데이터가 없으면 JSON 파일에서 조회 (백업)
    const fallbackResult = await getArtistsFromJSON(locale)
    artistCache?.set(cacheKey, fallbackResult)
    return fallbackResult
  } catch (error) {
    log.error('Error fetching artists from database:', error)

    // 오류 발생 시 JSON 파일에서 조회 (백업)
    const errorFallbackResult = await getArtistsFromJSON(locale)
    artistCache?.set(cacheKey, errorFallbackResult)
    return errorFallbackResult
  }
}

// JSON 파일에서 아티스트 조회 (백업용)
export const getArtistsFromJSON = async (locale = 'ko'): Promise<Artist[]> => {
  const filePath = locale === 'en'
    ? path.join(process.cwd(), 'data/en/artists.json')
    : path.join(process.cwd(), 'data/artists.json')
  try {
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    if (locale === 'en') {
      try {
        const fallback = path.join(process.cwd(), 'data/artists.json')
        return JSON.parse(await fs.promises.readFile(fallback, 'utf8'))
      } catch {}
    }
    log.error('Error loading artists data from JSON:', error)
    return []
  }
}

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtists = getArtistsFromDB

export const getProjects = cache(async (locale = 'ko'): Promise<Project[]> => {
  initCaches()

  const cacheKey = `projects:${locale}`
  const cached = projectCache?.get(cacheKey)
  if (cached) return cached

  const filePath = locale === 'en'
    ? path.join(process.cwd(), 'data/en/projects.json')
    : path.join(process.cwd(), 'data/projects.json')
  try {
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    const result = JSON.parse(fileContents)
    projectCache?.set(cacheKey, result)
    return result
  } catch (error) {
    if (locale === 'en') {
      try {
        const fallback = path.join(process.cwd(), 'data/projects.json')
        const result = JSON.parse(await fs.promises.readFile(fallback, 'utf8'))
        projectCache?.set(cacheKey, result)
        return result
      } catch {}
    }
    log.error('Error loading projects data:', error)
    const emptyResult: Project[] = []
    projectCache?.set(cacheKey, emptyResult)
    return emptyResult
  }
})

export const getGlobalData = cache(async (locale = 'ko'): Promise<GlobalData> => {
  const filePath = locale === 'en'
    ? path.join(process.cwd(), 'data/en/global.json')
    : path.join(process.cwd(), 'data/global.json')
  try {
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    if (locale === 'en') {
      try {
        const fallback = path.join(process.cwd(), 'data/global.json')
        return JSON.parse(await fs.promises.readFile(fallback, 'utf8'))
      } catch {}
    }
    log.error('Error loading global data:', error)
    return DEFAULT_GLOBAL_DATA
  }
})

export type FaqItem = { id: string; category: string; question: string; answer: string }

export const getFaqData = cache(async (locale = 'ko'): Promise<FaqItem[]> => {
  const filePath = locale === 'en'
    ? path.join(process.cwd(), 'data/en/faq.json')
    : path.join(process.cwd(), 'data/faq.json')
  try {
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    if (locale === 'en') {
      try {
        const fallback = path.join(process.cwd(), 'data/faq.json')
        return JSON.parse(await fs.promises.readFile(fallback, 'utf8'))
      } catch {}
    }
    log.error('Error loading FAQ data:', error)
    return []
  }
})

// ISR 최적화를 위한 revalidate 설정
//
// 주의: 본 모듈에는 두 계층의 TTL이 의도적으로 다르게 설정되어 있다.
//   - fetch level: 3600초 (1시간) — Supabase 호출 캐시. 아티스트 데이터가 자주 갱신되지 않으나,
//     관리자 수정 시 revalidateTag('artists')로 즉시 무효화 가능하므로 1시간으로 두어
//     stale 데이터 노출 시간을 짧게 유지한다.
//   - page/module level: 86400초 (24시간) — 전역(Global) 설정/JSON은 사실상 변경이 거의 없으므로
//     ISR로 길게 캐시한다. 여기 값과 fetch level 값이 다른 것은 각각이 다른 데이터에 적용되기
//     때문이며, 의도된 차이다.
export const revalidate = 86400

// DatabaseArtist를 Artist 타입으로 변환 — locale='en'이면 _en 컬럼 우선, 없으면 한국어 폴백
function convertDatabaseArtistToArtist(dbArtist: DatabaseArtist, locale = 'ko'): Artist {
  const useEn = locale === 'en'
  return {
    id: dbArtist.legacy_id,
    slug: dbArtist.slug,
    name: (useEn && dbArtist.name_en) ? dbArtist.name_en : dbArtist.name,
    category: dbArtist.category || [],
    profileImage:
      dbArtist.profile_photo_url ||
      dbArtist.profile_photo_metadata?.variant_urls?.webp ||
      dbArtist.profile_photo_metadata?.variant_urls?.fallback ||
      dbArtist.profile_photo_metadata?.variant_urls?.original ||
      '/images/default-avatar.webp',
    oneLiner: (useEn && dbArtist.one_liner_en) ? dbArtist.one_liner_en : (dbArtist.one_liner || ''),
    bio: (useEn && dbArtist.bio_en) ? dbArtist.bio_en : (dbArtist.bio || ''),
    templateType: ((useEn && dbArtist.template_type_en) ? dbArtist.template_type_en : (dbArtist.template_type || '콜라주형')) as Artist['templateType'],
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

async function buildEnArtistTextMap(): Promise<Map<string, Artist>> {
  if (!enArtistTextMapPromise) {
    enArtistTextMapPromise = (async () => {
      const enArtists = await getArtistsFromJSON('en')
      const map = new Map<string, Artist>()
      for (const a of enArtists) {
        if (a.slug) map.set(a.slug, a)
        if (a.id) map.set(a.id, a)
      }
      return map
    })()
  }
  return enArtistTextMapPromise
}

function overlayEnglishArtistText(artist: Artist, en?: Artist): Artist {
  if (!en) return artist
  return {
    ...artist,
    name: en.name || artist.name,
    oneLiner: en.oneLiner ?? artist.oneLiner,
    bio: en.bio ?? artist.bio,
    category: en.category ?? artist.category,
    templateType: (en.templateType ?? artist.templateType) as Artist['templateType'],
    portfolioLinks: en.portfolioLinks ?? artist.portfolioLinks,
    youtubeVideos: en.youtubeVideos ?? artist.youtubeVideos,
  }
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
export const getArtistBySlugFromDB = async (slug: string, locale = 'ko'): Promise<Artist | null> => {
  try {
    // 환경 변수 체크 추가
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      log.warn('Supabase environment variables not available, falling back to JSON')
      const artists = await getArtistsFromJSON(locale)
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
      let convertedArtist = convertDatabaseArtistToArtist(dbArtist, locale)

      try {
        const legacyMap = await getLegacyArtistMap()
        const fallback = legacyMap.get(convertedArtist.slug) || legacyMap.get(convertedArtist.id)
        convertedArtist = applyProfileImageFallback(convertedArtist, fallback)
      } catch (fallbackError) {
        log.warn('Failed to apply legacy artist image fallback:', fallbackError)
      }

      if (locale === 'en') {
        try {
          const enMap = await buildEnArtistTextMap()
          convertedArtist = overlayEnglishArtistText(
            convertedArtist,
            enMap.get(convertedArtist.slug) ?? enMap.get(convertedArtist.id)
          )
        } catch (enError) {
          log.warn('Failed to apply English text overlay:', enError)
        }
      }

      return convertedArtist
    }

    // 데이터베이스에 없으면 JSON 파일에서 조회 (백업)
    const artists = await getArtistsFromJSON(locale)
    return artists.find(artist => artist.slug === slug) || null
  } catch (error) {
    log.error('Error fetching artist from database:', error)

    // 오류 발생 시 JSON 파일에서 조회 (백업)
    const artists = await getArtistsFromJSON(locale)
    return artists.find(artist => artist.slug === slug) || null
  }
}

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtistBySlug = getArtistBySlugFromDB

export const getProjectBySlug = cache(async (slug: string, locale = 'ko'): Promise<Project | null> => {
  const projects = await getProjects(locale)
  return projects.find(project => project.slug === slug) || null
})

// 정렬된 프로젝트 가져오기 (최신순)
export const getProjectsSorted = cache(async (locale = 'ko'): Promise<Project[]> => {
  const projects = await getProjects(locale)
  return [...projects].sort(
    (a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime()
  )
})

// 특정 프로젝트들 가져오기 (홈페이지용)
export const getFeaturedProjects = cache(async (limit: number = 3, locale = 'ko'): Promise<Project[]> => {
  const sortedProjects = await getProjectsSorted(locale)
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
export const getProjectArtists = cache(async (artistIds: string[], locale = 'ko'): Promise<Artist[]> => {
  const artists = await getArtistsFromDB(locale)
  return artists.filter(artist => artistIds.includes(artist.id))
})

// 특정 아티스트가 참여한 프로젝트들 조회 (최신순 정렬)
export const getArtistProjects = cache(async (artistId: string, locale = 'ko'): Promise<Project[]> => {
  const projects = await getProjects(locale)
  return projects
    .filter(project => project.artistIds.includes(artistId))
    .sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime())
})
