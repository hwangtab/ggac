export interface LinkPreview {
  title: string
  description: string
  image: string
  siteName: string
  url: string
  favicon: string
}

export interface TicketingInfo {
  platform: string
  url: string
  available: boolean
  price?: string
  startDate?: string
  endDate?: string
  soldOutDate?: string
  preview?: LinkPreview
}

export interface RelatedArticle {
  title: string
  url: string
}

export interface ArticleInfo {
  title: string
  url: string
  preview?: LinkPreview
}

export interface EventVenue {
  name: string
  address?: string
}

export interface Project {
  id: string
  slug: string
  title: string
  category: string
  publishedDate: string
  /** 실제 공연일(ISO YYYY-MM-DD). 예매 시작일(ticketing.startDate)과 구분되는 이벤트 날짜. */
  eventDate?: string
  /** 공연장. 없으면 지역(경기도)으로 폴백. */
  venue?: EventVenue
  /** 취소된 공연이면 true (schema eventStatus를 EventCancelled로). */
  cancelled?: boolean
  coverImage: string
  description: string
  gallery?: string[]
  videoUrl?: string | null
  artistIds: string[]
  applicationForm?: {
    title: string
    url?: string
    internal?: boolean
  }
  ticketing?: TicketingInfo[]
  relatedArticles?: RelatedArticle[]
  summary?: string
}

export enum ProjectCategory {
  PERFORMANCE = '공연',
  EXHIBITION = '전시',
  MUSIC = '음악',
  MULTIMEDIA = '멀티미디어',
  COLLABORATION = '협업',
}

export type ProjectSummary = Pick<
  Project,
  'id' | 'slug' | 'title' | 'category' | 'publishedDate' | 'coverImage' | 'description'
>

export interface ProjectCardProps {
  project: Project
  showDescription?: boolean
  showArtists?: boolean
  className?: string
}

export interface ArticleCardProps {
  article: ArticleInfo
}

export interface TicketingCardProps {
  ticketing: TicketingInfo
}

export interface FeaturedProjectsProps {
  projects: Project[]
}

export interface BaseCardProps {
  title: string
  description: string
  category?: string
  image?: {
    src: string
    alt: string
    width?: number
    height?: number
  }
  href?: string
  date?: string
  author?: string
  className?: string
  variant?: 'default' | 'compact' | 'featured'
  hoverable?: boolean
  imagePosition?: 'top' | 'left' | 'right'
  footer?: React.ReactNode
  onClick?: () => void
}

export interface ArtistProjectsProps {
  projects: Project[]
  artistName?: string
  className?: string
}

export function isProject(obj: any): obj is Project {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.category === 'string' &&
    typeof obj.publishedDate === 'string' &&
    Array.isArray(obj.artistIds)
  )
}

export function isLinkPreview(obj: any): obj is LinkPreview {
  return typeof obj === 'object' && typeof obj.title === 'string' && typeof obj.url === 'string'
}
