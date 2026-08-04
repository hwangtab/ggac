/**
 * 구조화된 데이터 (JSON-LD) 생성 유틸리티
 * SEO 향상을 위한 schema.org 구조화된 데이터 제공
 */

import React from 'react'

import { generateImageUrl } from './imageUrl'
import { toSafeHttpUrl } from './safeUrl'

// 기본 조직 정보
const ORGANIZATION_DATA = {
  '@type': 'Organization',
  '@id': 'https://ggac.kr/#organization',
  name: '경기아트콜렉티브 협동조합',
  alternateName: 'Gyeonggi Art Collective',
  legalName: '경기아트콜렉티브 협동조합',
  description: '예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다.',
  url: 'https://ggac.kr',
  logo: 'https://ggac.kr/images/logo/gac_og.webp',
  foundingDate: '2025-05-01',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '성사동 719',
    addressLocality: '고양시 덕양구',
    addressRegion: '경기도',
    postalCode: '10577',
    addressCountry: 'KR',
  },
  contactPoint: {
    '@type': 'ContactPoint',
    telephone: '0507-1384-3144',
    email: 'contact@ggac.kr',
    contactType: 'customer service',
    availableLanguage: 'Korean',
  },
  areaServed: {
    '@type': 'AdministrativeArea',
    name: '경기도',
  },
  knowsAbout: ['음악 제작', '공연 기획', '시각예술', '예술교육', '문화예술 행사', '아티스트 협업'],
  sameAs: [
    'https://www.instagram.com/ggartcollective',
    'https://www.youtube.com/@%EA%B2%BD%EC%95%84%EC%BD%9C',
  ],
}

/**
 * 웹사이트 기본 구조화된 데이터 생성
 */
export function generateWebsiteStructuredData(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': 'https://ggac.kr/#website',
    name: '경기아트콜렉티브 협동조합',
    url: 'https://ggac.kr',
    description:
      '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다.',
    inLanguage: 'ko-KR',
    publisher: { '@id': 'https://ggac.kr/#organization' },
  }
}

/**
 * 프로젝트용 구조화된 데이터 생성
 */
export function generateProjectStructuredData(project: {
  title: string
  description: string
  slug: string
  date?: string
  coverImage?: string | null
  gallery?: string[]
  artistIds?: string[]
}): object {
  const imageUrl = generateImageUrl(project.coverImage || project.gallery?.[0], {
    absolute: true,
    forSocialSharing: true,
  })

  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    '@id': `https://ggac.kr/archive/${project.slug}#work`,
    name: project.title,
    description: project.description,
    url: `https://ggac.kr/archive/${project.slug}`,
    image: imageUrl,
    creator: { '@id': 'https://ggac.kr/#organization' },
    publisher: { '@id': 'https://ggac.kr/#organization' },
    dateCreated: project.date,
    genre: '예술 프로젝트',
    inLanguage: 'ko-KR',
    isPartOf: { '@id': 'https://ggac.kr/#website' },
  }
}

/**
 * 게시글용 구조화된 데이터 생성
 */
export function generatePostStructuredData(post: {
  id: string
  title: string
  content: string | null // content가 null일 수 있음을 명시
  category: string
  created_at: string
  updated_at?: string
  author?: {
    display_name: string
  }
  thumbnail?: string | null
}): object {
  const imageUrl = generateImageUrl(post.thumbnail, {
    absolute: true,
    forSocialSharing: true,
  })

  // HTML 태그 제거 및 null-safe 처리
  const stripped = (post.content || '').replace(/<[^>]*>/g, '').trim()
  const descriptionText = stripped.substring(0, 150)
  const descriptionSuffix = stripped.length > 150 ? '...' : ''
  // 한국어 본문은 공백 기준 단어 수가 의미가 약하므로 글자수를 wordCount로 사용.
  // schema.org Article의 wordCount는 정수만 허용된다.
  const wordCount = stripped.length

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: descriptionText
      ? `${descriptionText}${descriptionSuffix}`
      : `${post.title}에 대한 게시글입니다.`,
    url: `https://ggac.kr/board/${post.id}`,
    image: imageUrl,
    datePublished: post.created_at,
    dateModified: post.updated_at || post.created_at,
    author: {
      '@type': 'Person',
      name: post.author?.display_name || '경기아트콜렉티브',
    },
    publisher: { '@id': 'https://ggac.kr/#organization' },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://ggac.kr/board/${post.id}`,
    },
    articleSection: post.category,
    wordCount,
    inLanguage: 'ko-KR',
    isPartOf: { '@id': 'https://ggac.kr/#website' },
  }
}

/**
 * 아티스트용 구조화된 데이터 생성
 */
export function generateArtistStructuredData(artist: {
  name: string
  slug: string
  bio?: string
  /** 음악 장르 태그. schema.org의 genre는 음악 장르를 기대하므로 역할(category)이 아닌 이 값을 사용한다. */
  genres?: string[]
  profilePhotoUrl?: string | null
  portfolioLinks?: Array<{ title: string; url: string }> | null
}): object {
  const imageUrl = generateImageUrl(artist.profilePhotoUrl, {
    absolute: true,
    forSocialSharing: true,
  })

  const sameAs = artist.portfolioLinks
    ?.map(link => toSafeHttpUrl(link.url))
    .filter((url): url is string => Boolean(url))

  // 음악 장르가 있으면 음악가로 보고 MusicGroup으로 표기(AI 엔티티 인식 강화).
  // MusicGroup은 솔로·밴드 모두 포괄한다. 장르가 없는 비음악 활동가는 Person 유지.
  const isMusicGroup = !!(artist.genres && artist.genres.length > 0)

  return {
    '@context': 'https://schema.org',
    '@type': isMusicGroup ? 'MusicGroup' : 'Person',
    '@id': `https://ggac.kr/artists/${artist.slug}#person`,
    name: artist.name,
    description: artist.bio,
    url: `https://ggac.kr/artists/${artist.slug}`,
    image: imageUrl,
    memberOf: { '@id': 'https://ggac.kr/#organization' },
    // MusicGroup에는 genre를, Person에는 jobTitle/worksFor를 부여(타입별 유효 속성).
    ...(isMusicGroup
      ? { genre: artist.genres }
      : { jobTitle: '아티스트', worksFor: { '@id': 'https://ggac.kr/#organization' } }),
    inLanguage: 'ko-KR',
    ...(sameAs && sameAs.length > 0 ? { sameAs } : {}),
  }
}

/**
 * 이벤트(공연·전시)용 구조화된 데이터 생성
 */
export function generateEventStructuredData(project: {
  title: string
  description: string
  slug: string
  publishedDate: string
  eventDate?: string
  venue?: { name: string; address?: string }
  cancelled?: boolean
  coverImage?: string | null
  gallery?: string[]
  artistIds?: string[]
  /** 참여 아티스트 — MusicEvent.performer로 연결(엔티티 그래프 강화). */
  performers?: Array<{ name: string; url: string }>
  ticketing?: Array<{
    platform: string
    url: string
    available: boolean
    price?: string
    startDate?: string
    endDate?: string
  }>
  category: string
}): object {
  const imageUrl = generateImageUrl(project.coverImage || project.gallery?.[0], {
    absolute: true,
    forSocialSharing: true,
  })

  // 실제 공연일(eventDate) 우선 — 없으면 예매 시작일·발행일로 폴백.
  const eventDate = project.eventDate || project.ticketing?.[0]?.startDate || project.publishedDate
  // 공연일이 명시되면 단일 일정 이벤트이므로 endDate도 공연일과 동일하게 둔다.
  const endDate = project.eventDate
    ? project.eventDate
    : project.ticketing?.[0]?.endDate || eventDate

  // 공연장이 있으면 Place로, 없으면 지역(경기도)으로 폴백.
  const location = project.venue
    ? {
        '@type': 'Place',
        name: project.venue.name,
        ...(project.venue.address
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: project.venue.address,
                addressCountry: 'KR',
              },
            }
          : {}),
      }
    : {
        '@type': 'Place',
        name: '경기도',
        address: {
          '@type': 'PostalAddress',
          addressRegion: '경기도',
          addressCountry: 'KR',
        },
      }

  // Google Search Console에서 organizer/performer의 name·url 누락을
  // 경고로 잡았던 회귀 — @id 참조만으로는 부족하고 inline name+url 필수.
  const organizationRef = {
    '@type': 'Organization',
    '@id': 'https://ggac.kr/#organization',
    name: '경기아트콜렉티브 협동조합',
    url: 'https://ggac.kr',
  }

  const eventUrl = `https://ggac.kr/archive/${project.slug}`

  // 음악 공연이므로 MusicEvent로 승격(AI 답변엔진의 공연·음악 질의 매칭 강화).
  // 참여 아티스트가 있으면 performer로 연결, 없으면 주최 조합으로 폴백.
  const performer =
    project.performers && project.performers.length > 0
      ? project.performers.map(p => ({ '@type': 'MusicGroup', name: p.name, url: p.url }))
      : organizationRef

  const eventSchema: any = {
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: project.title,
    description: project.description,
    url: eventUrl,
    image: imageUrl,
    startDate: eventDate,
    // endDate가 따로 없으면 startDate와 동일하게 둬서 GSC 경고 회피 (단일 일정 이벤트로 표현)
    endDate: endDate || eventDate,
    eventStatus: project.cancelled
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location,
    organizer: organizationRef,
    performer,
    inLanguage: 'ko-KR',
  }

  // 티켓팅 정보가 있으면 그대로 매핑, 없으면 무료 입장(=offers 추천 필드 충족)
  if (project.ticketing && project.ticketing.length > 0) {
    eventSchema.offers = project.ticketing.map((ticket: any) => ({
      '@type': 'Offer',
      url: toSafeHttpUrl(ticket.url) ?? eventUrl,
      price: ticket.price || '0',
      priceCurrency: 'KRW',
      availability: ticket.available ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      validFrom: ticket.startDate,
      validThrough: ticket.endDate,
    }))
  } else {
    eventSchema.offers = [
      {
        '@type': 'Offer',
        url: eventUrl,
        price: '0',
        priceCurrency: 'KRW',
        availability: 'https://schema.org/InStock',
        validFrom: eventDate,
      },
    ]
  }

  return eventSchema
}

/**
 * 목록 페이지용 ItemList 구조화된 데이터 생성
 */
export function generateItemListStructuredData(
  items: Array<{ name: string; url: string }>
): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  }
}

/**
 * 브레드크럼 네비게이션 구조화된 데이터 생성
 */
export function generateBreadcrumbStructuredData(
  items: Array<{
    name: string
    url: string
  }>
): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

/**
 * 조직 정보 구조화된 데이터 생성
 */
export function generateOrganizationStructuredData(): object {
  return {
    '@context': 'https://schema.org',
    ...ORGANIZATION_DATA,
  }
}

/**
 * FAQ 구조화된 데이터 생성
 */
export function generateFAQStructuredData(
  faqs: Array<{
    question: string
    answer: string
  }>
): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}

/**
 * 구조화된 데이터를 JSON-LD script 태그로 변환
 * @warning Server Component 트리에서만 호출해야 합니다.
 * Client Component에서 호출하면 hydration 오류가 발생할 수 있습니다.
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function structuredDataToScript(data: object): React.ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeJsonLd(data),
      }}
    />
  )
}

/**
 * 여러 구조화된 데이터를 병합
 * @graph 내 아이템에서 중복 @context 필드를 제거
 */
export function combineStructuredData(dataArray: object[]): object {
  if (dataArray.length === 1) {
    return dataArray[0]
  }

  const graphItems = dataArray.map(item => {
    const { '@context': _ctx, ...rest } = item as Record<string, unknown>
    return rest
  })

  return {
    '@context': 'https://schema.org',
    '@graph': graphItems,
  }
}
