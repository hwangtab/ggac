import Hero from '@/components/Hero'
import FeaturedProjects from '@/components/FeaturedProjects'
import FeaturedArtists from '@/components/FeaturedArtists'
import ScrollReveal from '@/components/ScrollReveal'
import { getFeaturedProjects, getArtists } from '@/lib/data'
import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { getLocaleAlternates, getOgLocale } from '@/utils/site'
import {
  generateWebsiteStructuredData,
  generateOrganizationStructuredData,
  structuredDataToScript,
  combineStructuredData,
} from '@/utils/structuredData'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'

  const title = isEn
    ? 'Gyeonggi Art Collective — Korean Indie Music Cooperative'
    : '경기아트콜렉티브 협동조합 — 경기 인디 뮤지션·밴드 커뮤니티'
  const description = isEn
    ? 'A cooperative of indie musicians and bands from Gyeonggi, Korea — doom metal, punk, and experimental music beyond the mainstream, with self-produced live shows.'
    : '경기도 인디 뮤지션·밴드가 만든 생산자 협동조합. 둠메탈·펑크·실험음악 등 상업 무대 바깥의 음악을 만들고, 철조망·건강열전 같은 공연을 직접 기획합니다.'
  const ogDescription = isEn
    ? 'Korean indie music cooperative — doom metal, punk, and experimental music, with self-produced live shows.'
    : '둠메탈·펑크·실험음악을 만들고 직접 공연을 기획하는 경기도 인디 뮤지션·밴드 협동조합.'

  return {
    title: { absolute: title },
    description,
    keywords: [
      '경기아트콜렉티브',
      '인디음악',
      '인디밴드',
      '언더그라운드',
      '둠메탈',
      '메탈공연',
      '펑크',
      '실험음악',
      '뮤지션',
      '라이브공연',
      '경기도',
      '수원',
    ],
    alternates: getLocaleAlternates('/', locale),
    openGraph: {
      title,
      description: ogDescription,
      url: getLocaleAlternates('/', locale).canonical,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      locale: getOgLocale(locale),
      type: 'website',
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: ogDescription,
      images: ['/images/logo/gac_og.webp'],
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}

interface HomeProps {
  params: Promise<{ locale: string }>
}

export default async function Home({ params }: HomeProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const featuredProjects = await getFeaturedProjects(3, locale)
  const artists = await getArtists(locale)

  // 구조화된 데이터 생성
  const websiteData = generateWebsiteStructuredData()
  const organizationData = generateOrganizationStructuredData()
  const combinedStructuredData = combineStructuredData([websiteData, organizationData])

  return (
    <div data-home-page="true">
      {structuredDataToScript(combinedStructuredData)}
      <Hero artists={artists} />
      <ScrollReveal>
        <FeaturedProjects projects={featuredProjects} />
      </ScrollReveal>
      <ScrollReveal delay={120}>
        <FeaturedArtists artists={artists} />
      </ScrollReveal>
    </div>
  )
}
