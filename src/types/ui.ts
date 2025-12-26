import type { PortfolioLink, YouTubeVideo } from './artist'

export interface MediaManagerProps {
  currentImage?: string
  onImageUpdate: (imageUrl: string) => void
  loading?: boolean
  maxSize?: number // bytes
  acceptedTypes?: string[]
  className?: string
}

export interface PortfolioLinksProps {
  links: PortfolioLink[]
  onChange: (links: PortfolioLink[]) => void
  maxLinks?: number
  className?: string
}

export interface YoutubeVideosProps {
  videos: YouTubeVideo[]
  onChange: (videos: YouTubeVideo[]) => void
  maxVideos?: number
  className?: string
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  maxHeight?: number
  className?: string
}

export interface FileUploadResponse {
  success: boolean
  url?: string
  error?: string
  originalName?: string
  size?: number
  type?: string
}

export const FILE_UPLOAD_LIMITS = {
  MAX_SIZE: 5 * 1024 * 1024, // 5MB
  ACCEPTED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  MAX_PORTFOLIO_LINKS: 10,
  MAX_YOUTUBE_VIDEOS: 20,
} as const
