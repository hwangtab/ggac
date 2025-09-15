/**
 * 구조화된 데이터 (JSON-LD) 생성 유틸리티
 * SEO 향상을 위한 schema.org 구조화된 데이터 제공
 */

import React from 'react'

import { generateImageUrl } from './imageUrl'

// 기본 조직 정보
const ORGANIZATION_DATA = {
  '@type': 'Organization',
  name: '경기아트콜렉티브 협동조합',
  alternateName: 'Gyeonggi Art Collective',
  description: '예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다.',
  url: 'https://ggac.kr',
  logo: 'https://ggac.kr/images/logo/gac_og_branded.webp',
  foundingDate: '2024',
  address: {
    '@type': 'PostalAddress',
    addressLocality: '수원시',
    addressRegion: '경기도',
    addressCountry: 'KR',
  },
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer service',
    availableLanguage: 'Korean',
  },
  sameAs: [
    // SNS 계정이 있다면 여기에 추가
  ],
}

/**
 * 웹사이트 기본 구조화된 데이터 생성
 */
export function generateWebsiteStructuredData(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '경기아트콜렉티브 협동조합',
    url: 'https://ggac.kr',
    description:
      '경계 없는 상상, 함께 만드는 울림. 예술로 숨 쉬고, 협동으로 길을 내는 협동조합입니다.',
    publisher: ORGANIZATION_DATA,
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://ggac.kr/search?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
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
    name: project.title,
    description: project.description,
    url: `https://ggac.kr/archive/${project.slug}`,
    image: imageUrl,
    creator: ORGANIZATION_DATA,
    publisher: ORGANIZATION_DATA,
    dateCreated: project.date,
    genre: '예술 프로젝트',
    inLanguage: 'ko-KR',
    isPartOf: {
      '@type': 'WebSite',
      name: '경기아트콜렉티브 협동조합',
      url: 'https://ggac.kr',
    },
  }
}

/**
 * 게시글용 구조화된 데이터 생성
 */
export function generatePostStructuredData(post: {
  id: string
  title: string
  content: string
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

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.content.substring(0, 160) + '...',
    url: `https://ggac.kr/board/${post.id}`,
    image: imageUrl,
    datePublished: post.created_at,
    dateModified: post.updated_at || post.created_at,
    author: {
      '@type': 'Person',
      name: post.author?.display_name || '경기아트콜렉티브',
    },
    publisher: ORGANIZATION_DATA,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://ggac.kr/board/${post.id}`,
    },
    articleSection: post.category,
    inLanguage: 'ko-KR',
    isPartOf: {
      '@type': 'WebSite',
      name: '경기아트콜렉티브 협동조합',
      url: 'https://ggac.kr',
    },
  }
}

/**
 * 아티스트용 구조화된 데이터 생성
 */
export function generateArtistStructuredData(artist: {
  name: string
  slug: string
  bio?: string
  categories?: string[]
  profilePhotoUrl?: string | null
}): object {
  const imageUrl = generateImageUrl(artist.profilePhotoUrl, {
    absolute: true,
    forSocialSharing: true,
  })

  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: artist.name,
    description: artist.bio,
    url: `https://ggac.kr/artists/${artist.slug}`,
    image: imageUrl,
    jobTitle: '아티스트',
    worksFor: ORGANIZATION_DATA,
    nationality: 'Korean',
    memberOf: {
      '@type': 'Organization',
      name: '경기아트콜렉티브 협동조합',
    },
    genre: artist.categories?.join(', '),
    inLanguage: 'ko-KR',
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
 */
export function structuredDataToScript(data: object): React.ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data, null, 0),
      }}
    />
  )
}

/**
 * 여러 구조화된 데이터를 병합
 */
export function combineStructuredData(dataArray: object[]): object {
  if (dataArray.length === 1) {
    return dataArray[0]
  }

  return {
    '@context': 'https://schema.org',
    '@graph': dataArray,
  }
}
