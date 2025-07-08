import { load } from 'cheerio'
import type { LinkPreview, TicketingInfo } from '@/types'

// 기존에 별도로 정의되어 있던 TicketingInfo를 export로 유지 (하위 호환성)
export type { LinkPreview, TicketingInfo } from '@/types'

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    console.log(`Fetching link preview for: ${url}`)
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      next: { revalidate: 3600 } // 1시간 캐시
    })
    
    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
      return null
    }
    
    const html = await response.text()
    const $ = load(html)
    
    // 메타데이터 추출
    const getMetaContent = (property: string, name?: string): string => {
      // Open Graph 태그 우선
      let content = $(`meta[property="${property}"]`).attr('content')
      
      // name 속성으로 찾기
      if (!content && name) {
        content = $(`meta[name="${name}"]`).attr('content')
      }
      
      return content?.trim() || ''
    }
    
    // 이미지 URL 정규화
    const normalizeImageUrl = (imageUrl: string): string => {
      if (!imageUrl) return ''
      
      // 절대 URL인 경우 그대로 반환
      if (imageUrl.startsWith('http')) {
        return imageUrl
      }
      
      // 상대 URL인 경우 절대 URL로 변환
      try {
        const baseUrl = new URL(url)
        if (imageUrl.startsWith('//')) {
          return `${baseUrl.protocol}${imageUrl}`
        } else if (imageUrl.startsWith('/')) {
          return `${baseUrl.protocol}//${baseUrl.host}${imageUrl}`
        } else {
          return `${baseUrl.protocol}//${baseUrl.host}/${imageUrl}`
        }
      } catch {
        return imageUrl
      }
    }
    
    // 파비콘 찾기
    const getFaviconUrl = (): string => {
      let favicon = $('link[rel="icon"]').attr('href') || 
                   $('link[rel="shortcut icon"]').attr('href') ||
                   $('link[rel="apple-touch-icon"]').attr('href')
      
      if (!favicon) {
        // 기본 파비콘 경로 시도
        try {
          const baseUrl = new URL(url)
          favicon = `${baseUrl.protocol}//${baseUrl.host}/favicon.ico`
        } catch {
          favicon = ''
        }
      }
      
      return normalizeImageUrl(favicon)
    }
    
    const title = getMetaContent('og:title') || 
                  $('title').text() || 
                  getMetaContent('twitter:title', 'title')
    
    const description = getMetaContent('og:description') || 
                       getMetaContent('twitter:description', 'description')
    
    const image = normalizeImageUrl(
      getMetaContent('og:image') || 
      getMetaContent('twitter:image')
    )
    
    const siteName = getMetaContent('og:site_name') || 
                    $('title').text().split(' - ')[0] || 
                    new URL(url).hostname
    
    const favicon = getFaviconUrl()
    
    // XSS 방지를 위한 데이터 정제
    const sanitizeText = (text: string): string => {
      if (typeof text !== 'string') return ''
      return text
        .replace(/[<>"'&]/g, (char) => {
          const map: { [key: string]: string } = {
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '&': '&amp;'
          }
          return map[char] || char
        })
        .replace(/\s+/g, ' ')
        .trim()
    }

    const preview: LinkPreview = {
      title: sanitizeText(title).slice(0, 100), // 제목 길이 제한 및 XSS 방지
      description: sanitizeText(description).slice(0, 200), // 설명 길이 제한 및 XSS 방지
      image,
      siteName: sanitizeText(siteName).slice(0, 50), // 사이트명 XSS 방지
      url,
      favicon
    }
    
    console.log(`Successfully extracted preview for ${url}:`, preview)
    return preview
    
  } catch (error) {
    console.error(`Error fetching link preview for ${url}:`, error)
    return null
  }
}

// 여러 URL의 프리뷰를 동시에 가져오기
export async function fetchMultipleLinkPreviews(urls: string[]): Promise<(LinkPreview | null)[]> {
  const promises = urls.map(url => fetchLinkPreview(url))
  return Promise.all(promises)
}

