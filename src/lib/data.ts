import fs from 'fs'
import path from 'path'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createLogger } from '@/utils/logger'
import { listArtists, getArtistBySlug as getArtistBySlugQuery } from '@/db/queries/artists'

const log = createLogger('data')

// 캐시 전략(단일화): Task 4 이전에는 Supabase 조회의 Next 데이터 캐시(fetch
// revalidate+tags:['artists'])가 유일한 인스턴스 간 캐시였다. Turso(libsql)
// 쿼리는 fetch()를 거치지 않으므로 그 메커니즘이 통하지 않는다 — 대신
// `unstable_cache`로 같은 tags:['artists']/revalidate:3600 계약을 그대로
// 재현한다. `revalidateTag('artists')`를 호출하는 기존 소비처
// (`src/app/api/mypage/artist/route.ts`·`photo/route.ts`)는 변경 없이 계속
// 이 캐시를 무효화한다 — Next의 태그 기반 무효화는 어떤 캐싱 API를 썼는지와
// 무관하게 동작한다. React `cache()`는 여전히 같은 요청/렌더 내 중복 호출만
// 메모한다.
// 과거의 모듈 레벨 인메모리 TTL 캐시(MemoryEfficientCache)는 revalidateTag('artists')로
// 무효화되지 않아 관리자 수정 후 최대 5분 stale을 만들고, 빌드 워커 간 상태 공유로
// 프리렌더 결과를 비결정적으로 만들어 제거했다(2026-07 전수감사 P4).
const getCachedArtistRows = unstable_cache(async () => listArtists(), ['ggac-artists-all'], {
  revalidate: 3600,
  tags: ['artists'],
})
const getCachedArtistRowBySlug = unstable_cache(
  async (slug: string) => getArtistBySlugQuery(slug),
  ['ggac-artist-by-slug'],
  { revalidate: 3600, tags: ['artists'] }
)
let legacyArtistMapPromise: Promise<Map<string, Artist>> | null = null
let enArtistTextMapPromise: Promise<Map<string, Artist>> | null = null

// 외부에서 아티스트 관련 모듈 상태를 무효화할 수 있도록 헬퍼를 노출.
// Next 데이터 캐시는 호출부의 revalidateTag('artists')가 담당한다.
export function invalidateArtistsCache() {
  legacyArtistMapPromise = null
  enArtistTextMapPromise = null
}
// 중앙화된 타입 시스템에서 임포트
import type { Artist, Project, GlobalData, DatabaseArtist } from '@/types'

// 타입을 re-export하여 다른 파일에서 사용 가능하게 함
export type { Artist, Project, GlobalData } from '@/types'

// 에러 처리를 위한 기본값들
const DEFAULT_GLOBAL_DATA: GlobalData = {
  siteName: '경기아트콜렉티브 협동조합',
  siteDescription: '서울 밖에서 시끄러워집니다',
  joinFormUrl: '',
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

/**
 * 공개 아티스트 데이터가 DB에서 오지 못했을 때 `data/artists.json`으로
 * 되돌아가도 되는지.
 *
 * **운영에서는 안 된다.** 이 폴백은 에러도 빈 화면도 만들지 않아서, Turso가
 * 실패하면 방문자는 아무 이상 없어 보이는 페이지에서 **과거 스냅샷**을 본다
 * (최종 리뷰 B-1 실측: `next build`가 exit 0으로 초록불을 내면서
 * `data/artists.json`의 옛 명단을 `.next/server/app/ko/artists.html`과 상세
 * 페이지들에 그대로 구워 배포에 실었다). 조합원이 마이페이지에서 고친
 * 소개글·사진은 DB에만 있으므로 그 상태는 "몇 주 전 프로필을 계속 보여주는
 * 사이트"다. 같은 문을 여는 두 번째 경로도 실재한다 — `artists.category` 한
 * 행만 JSON 인코딩이 깨져도 Drizzle `mode:'json'` 디코딩이 `listArtists()`
 * 전체를 던져 13명 전부가 폴백으로 넘어간다.
 *
 * 그래서 **폴백을 어디까지 남길지**를 환경으로 가른다:
 *  · 개발/테스트(`NODE_ENV !== 'production'`) — 그대로 남긴다. DB 없이
 *    `npm run dev`로 공개 페이지를 여는 것은 흔하고 유용하며, 그 상태는
 *    배포되지 않는다.
 *  · 운영 빌드·운영 런타임 — **금지한다.** 던져서 빌드를 빨간불로 만든다.
 *    이미 빌드된 페이지의 런타임 재검증(ISR)에서 던지면 Next는 마지막으로
 *    성공한(=DB에서 온) 캐시본을 계속 내보내고 에러를 로그에 남긴다 —
 *    JSON으로 갈아끼우는 것보다 낫다.
 *
 * 상세 페이지의 "행이 없다"는 이 함수를 타지 않는다. 그건 조회 실패가 아니라
 * 404이고, 운영에서는 JSON으로 되살리지 않고 `null`(→ notFound)로 둔다.
 */
class PublicArtistDataUnavailableError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(
      `공개 아티스트 데이터를 DB에서 가져오지 못했다(${reason}). ` +
        '운영에서는 data/artists.json 폴백을 쓰지 않는다 — 조용히 과거 데이터를 ' +
        '배포에 굽는 것을 막기 위해 실패로 처리한다.',
      options
    )
    this.name = 'PublicArtistDataUnavailableError'
  }
}

function refusePublicArtistJsonFallback(reason: string, cause?: unknown): void {
  if (process.env.NODE_ENV !== 'production') return
  throw new PublicArtistDataUnavailableError(reason, { cause })
}

/**
 * 이 오류는 `generateStaticParams`처럼 "빌드를 살리려고" 예외를 삼키는 자리에서도
 * 반드시 다시 던져야 한다 — 삼키면 B-1이 그대로 되살아난다.
 */
export function isPublicArtistDataUnavailable(error: unknown): boolean {
  return error instanceof PublicArtistDataUnavailableError
}

// Turso(artists 쿼리 계층)에서 전체 아티스트 목록 조회 (데이터베이스 우선, JSON 파일 백업)
// locale은 DB 없이 JSON 폴백 경로에서만 적용됨 (DB _en 컬럼은 Phase 5에서 추가)
// React cache(): 같은 렌더에서 여러 컴포넌트가 호출해도 1회만 실행.
export const getArtistsFromDB = cache(async (locale = 'ko'): Promise<Artist[]> => {
  // 폴백 금지 판정을 try 밖에서 하기 위해 조회 결과와 오류를 먼저 분리한다.
  // try 안에서 던지면 바로 아래 catch가 그것을 다시 삼켜 폴백으로 되돌린다.
  let dbArtists: Awaited<ReturnType<typeof getCachedArtistRows>>
  try {
    dbArtists = await getCachedArtistRows()
  } catch (error) {
    log.error('Error fetching artists from database:', error)
    refusePublicArtistJsonFallback('조회 실패', error)
    // 개발/테스트에서만 여기 도달한다.
    return await getArtistsFromJSON(locale)
  }

  if (dbArtists.length === 0) {
    log.error('아티스트 조회 결과가 0건이다 — DB가 비었거나 잘못된 DB를 보고 있다')
    refusePublicArtistJsonFallback('조회 결과 0건')
    // 데이터베이스에 데이터가 없으면 JSON 파일에서 조회 (백업, 비운영 한정)
    return await getArtistsFromJSON(locale)
  }

  let result = dbArtists.map(a =>
    convertDatabaseArtistToArtist(a as unknown as DatabaseArtist, locale)
  )

  try {
    const legacyMap = await getLegacyArtistMap()
    result = result.map(artist => {
      const fallback = legacyMap.get(artist.slug) || legacyMap.get(artist.id)
      return applyLegacyArtistFallback(artist, fallback)
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

  return result
})

// JSON 파일에서 아티스트 조회 (백업용)
export const getArtistsFromJSON = async (locale = 'ko'): Promise<Artist[]> => {
  const filePath =
    locale === 'en'
      ? path.join(process.cwd(), 'data/en/artists.json')
      : path.join(process.cwd(), 'data/artists.json')
  const normalizeNames = (list: Artist[]): Artist[] =>
    list.map(a => ({ ...a, name: normalizeArtistName(a.name) }))
  try {
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return normalizeNames(JSON.parse(fileContents))
  } catch (error) {
    if (locale === 'en') {
      try {
        const fallback = path.join(process.cwd(), 'data/artists.json')
        return normalizeNames(JSON.parse(await fs.promises.readFile(fallback, 'utf8')))
      } catch {}
    }
    log.error('Error loading artists data from JSON:', error)
    return []
  }
}

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtists = getArtistsFromDB

export const getProjects = cache(async (locale = 'ko'): Promise<Project[]> => {
  const filePath =
    locale === 'en'
      ? path.join(process.cwd(), 'data/en/projects.json')
      : path.join(process.cwd(), 'data/projects.json')
  try {
    const fileContents = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(fileContents)
  } catch (error) {
    if (locale === 'en') {
      try {
        const fallback = path.join(process.cwd(), 'data/projects.json')
        return JSON.parse(await fs.promises.readFile(fallback, 'utf8'))
      } catch {}
    }
    log.error('Error loading projects data:', error)
    return []
  }
})

export const getGlobalData = cache(async (locale = 'ko'): Promise<GlobalData> => {
  const filePath =
    locale === 'en'
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
  const filePath =
    locale === 'en'
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

// 참고: 과거 이 파일에 있던 `export const revalidate = 86400`은 라우트 세그먼트
// 파일이 아니어서 아무 효과가 없는 죽은 선언이라 제거했다. 조회의 TTL은
// (단계 4 이전엔 Supabase 조회 fetch의 revalidate+tags, 이후로는)
// `getCachedArtistRows`/`getCachedArtistRowBySlug`의 `unstable_cache`
// (revalidate:3600, tags:['artists'])가 담당한다.

// DatabaseArtist를 Artist 타입으로 변환 — locale='en'이면 _en 컬럼 우선, 없으면 한국어 폴백
// 아티스트 표기명의 괄호 앞 공백을 한 칸으로 통일한다(언어 순서 등 원본 표기는 유지).
// 예: '후추맨(Pepperman)' → '후추맨 (Pepperman)', 'ANAZAO(아나자오)' → 'ANAZAO (아나자오)'.
// 이름은 DB가 원천이라 로딩 시 정규화하면 목록·상세·OG·스키마 소비처가 일괄 통일된다.
export function normalizeArtistName(name: string): string {
  if (!name) return name
  // 1) 괄호 앞뒤 공백을 한 칸으로 정규화
  const spaced = name
    .replace(/(\S)\s*\(/g, '$1 (')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
  // 2) 표기 구조를 '영어 (한글)'로 통일 — 한글이 앞이고 괄호 안이 영어면 뒤집는다.
  //    예: '후추맨 (Pepperman)' → 'Pepperman (후추맨)'. 영어가 앞인 경우(Sabbaha (사바하))는 유지.
  const m = spaced.match(/^(.+?) \((.+?)\)$/)
  if (m) {
    const [, outer, inner] = m
    const hasHangul = (s: string) => /[가-힣]/.test(s)
    if (hasHangul(outer) && !hasHangul(inner) && /[A-Za-z]/.test(inner)) {
      return `${inner} (${outer})`
    }
  }
  return spaced
}

function convertDatabaseArtistToArtist(dbArtist: DatabaseArtist, locale = 'ko'): Artist {
  const useEn = locale === 'en'
  return {
    id: dbArtist.legacy_id,
    slug: dbArtist.slug,
    name: normalizeArtistName(useEn && dbArtist.name_en ? dbArtist.name_en : dbArtist.name),
    category: dbArtist.category || [],
    // DB에는 장르·리드 컬럼이 없으므로 undefined로 두고, legacy JSON 오버레이로 채운다.
    genres: dbArtist.genres ?? undefined,
    lead: dbArtist.lead ?? undefined,
    profileImage:
      dbArtist.profile_photo_url ||
      dbArtist.profile_photo_metadata?.variant_urls?.webp ||
      dbArtist.profile_photo_metadata?.variant_urls?.fallback ||
      dbArtist.profile_photo_metadata?.variant_urls?.original ||
      '/images/default-avatar.webp',
    oneLiner: useEn && dbArtist.one_liner_en ? dbArtist.one_liner_en : dbArtist.one_liner || '',
    bio: useEn && dbArtist.bio_en ? dbArtist.bio_en : dbArtist.bio || '',
    templateType: (useEn && dbArtist.template_type_en
      ? dbArtist.template_type_en
      : dbArtist.template_type || '콜라주형') as Artist['templateType'],
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
    // 실패한 promise가 모듈 캐시에 고착되어 이후 호출까지 전부 실패로 만드는 것 방지
    legacyArtistMapPromise.catch(() => {
      legacyArtistMapPromise = null
    })
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
    enArtistTextMapPromise.catch(() => {
      enArtistTextMapPromise = null
    })
  }
  return enArtistTextMapPromise
}

function overlayEnglishArtistText(artist: Artist, en?: Artist): Artist {
  if (!en) return artist
  return {
    ...artist,
    name: normalizeArtistName(en.name || artist.name),
    oneLiner: en.oneLiner ?? artist.oneLiner,
    bio: en.bio ?? artist.bio,
    category: en.category ?? artist.category,
    genres: en.genres ?? artist.genres,
    lead: en.lead ?? artist.lead,
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

// DB 아티스트에 legacy JSON(data/artists.json)의 보강 필드를 오버레이한다.
// 음악 장르는 DB에 컬럼이 없어 JSON을 단일 원천으로 삼는다(genres 비어 있으면 채움).
// 프로필 이미지 폴백과 함께 두 조회 경로(목록·단일)에서 공통 적용한다.
function applyLegacyArtistFallback(artist: Artist, fallback?: Artist): Artist {
  let result = applyProfileImageFallback(artist, fallback)
  const needsGenres = !result.genres || result.genres.length === 0
  if (needsGenres && fallback?.genres && fallback.genres.length > 0) {
    result = { ...result, genres: fallback.genres }
  }
  if (!result.lead && fallback?.lead) {
    result = { ...result, lead: fallback.lead }
  }
  return result
}

// Turso(artists 쿼리 계층)에서 아티스트 조회 (데이터베이스 우선, JSON 파일 백업)
export const getArtistBySlugFromDB = cache(
  async (slug: string, locale = 'ko'): Promise<Artist | null> => {
    // 목록(getArtistsFromDB)과 같은 이유로 조회 결과와 오류를 try 밖에서 가른다.
    let dbArtist: Awaited<ReturnType<typeof getCachedArtistRowBySlug>>
    try {
      dbArtist = await getCachedArtistRowBySlug(slug)
    } catch (error) {
      log.error('Error fetching artist from database:', error)
      refusePublicArtistJsonFallback(`상세 조회 실패(slug=${slug})`, error)
      // 오류 발생 시 JSON 파일에서 조회 (백업, 비운영 한정)
      const artists = await getArtistsFromJSON(locale)
      return artists.find(artist => artist.slug === slug) || null
    }

    if (!dbArtist) {
      // "행이 없다"는 조회 실패가 아니라 404다. 운영에서는 JSON으로
      // 되살리지 않는다 — 그러면 DB에서 지운 아티스트가 배포에서 계속 살아난다.
      if (process.env.NODE_ENV === 'production') return null
      // 데이터베이스에 없으면 JSON 파일에서 조회 (백업, 비운영 한정)
      const artists = await getArtistsFromJSON(locale)
      return artists.find(artist => artist.slug === slug) || null
    }

    let convertedArtist = convertDatabaseArtistToArtist(
      dbArtist as unknown as DatabaseArtist,
      locale
    )

    try {
      const legacyMap = await getLegacyArtistMap()
      const fallback = legacyMap.get(convertedArtist.slug) || legacyMap.get(convertedArtist.id)
      convertedArtist = applyLegacyArtistFallback(convertedArtist, fallback)
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
)

// 기존 함수를 새로운 DB 조회 함수로 교체
export const getArtistBySlug = getArtistBySlugFromDB

export const getProjectBySlug = cache(
  async (slug: string, locale = 'ko'): Promise<Project | null> => {
    const projects = await getProjects(locale)
    return projects.find(project => project.slug === slug) || null
  }
)

// 정렬된 프로젝트 가져오기 (최신순)
export const getProjectsSorted = cache(async (locale = 'ko'): Promise<Project[]> => {
  const projects = await getProjects(locale)
  return [...projects].sort(
    (a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime()
  )
})

// 특정 프로젝트들 가져오기 (홈페이지용)
export const getFeaturedProjects = cache(
  async (limit: number = 3, locale = 'ko'): Promise<Project[]> => {
    const sortedProjects = await getProjectsSorted(locale)
    return sortedProjects.slice(0, limit)
  }
)

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
export const getProjectArtists = cache(
  async (artistIds: string[], locale = 'ko'): Promise<Artist[]> => {
    const artists = await getArtistsFromDB(locale)
    return artists.filter(artist => artistIds.includes(artist.id))
  }
)

// 특정 아티스트가 참여한 프로젝트들 조회 (최신순 정렬)
export const getArtistProjects = cache(
  async (artistId: string, locale = 'ko'): Promise<Project[]> => {
    const projects = await getProjects(locale)
    return projects
      .filter(project => project.artistIds.includes(artistId))
      .sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime())
  }
)
