import type { ProfilePhotoMetadata } from './media'
import type { MemberProfile } from './auth'

export interface Artist {
  id: string
  slug: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
  bio: string
  templateType: 'minimal' | 'collage' | '미니멀형' | '콜라주형'
  portfolioLinks: PortfolioLink[] | null
  youtubeVideos?: YouTubeVideo[]
  contact: string | null
}

export interface PortfolioLink {
  title: string
  url: string
}

export interface YouTubeVideo {
  title: string
  url: string
}

export enum ArtistCategory {
  CREATOR = '창작자',
  ORGANIZER = '기획자',
  BOTH = '창작자/기획자',
}

export type ArtistSummary = Pick<
  Artist,
  'id' | 'slug' | 'name' | 'category' | 'profileImage' | 'oneLiner'
>

export interface ArtistCardProps {
  artist: Artist
  showCategory?: boolean
  showBio?: boolean
  className?: string
}

export interface FeaturedArtistsProps {
  artists: Artist[]
}

export interface DatabaseArtist {
  id: string
  legacy_id: string
  slug: string
  name: string
  category: string[]
  profile_photo_url: string | null
  profile_photo_metadata?: ProfilePhotoMetadata
  one_liner: string
  bio: string
  template_type: '미니멀형' | '콜라주형'
  portfolio_links: PortfolioLink[]
  youtube_videos: YouTubeVideo[]
  contact: string
  created_at: string
  updated_at: string

  members?: {
    id: string
    display_name: string
    artist_role: 'owner' | 'manager' | 'collaborator'
    is_active: boolean
    registration_status: 'pending' | 'approved' | 'rejected'
  }[]
}

export interface ArtistMemberRelation {
  artist_uuid: string
  artist_id: string
  slug: string
  artist_name: string
  member_id: string
  member_name: string
  artist_role: 'owner' | 'manager' | 'collaborator'
  member_active: boolean
  registration_status: 'pending' | 'approved' | 'rejected'
}

export interface ArtistEditFormProps {
  artist: DatabaseArtist
  onUpdate: (updates: Partial<DatabaseArtist>) => Promise<void>
  loading?: boolean
  className?: string
}

export interface ArtistUpdateRequest {
  name?: string
  category?: string[]
  one_liner?: string
  bio?: string
  template_type?: '미니멀형' | '콜라주형'
  profile_photo_url?: string | null
  profile_photo_metadata?: ProfilePhotoMetadata
  portfolio_links?: PortfolioLink[]
  youtube_videos?: YouTubeVideo[]
  contact?: string
}

export interface ArtistPermissionCheck {
  hasPermission: boolean
  artist?: DatabaseArtist
  role?: 'owner' | 'manager' | 'collaborator'
  error?: string
}

export type ArtistSummaryDB = Pick<
  DatabaseArtist,
  | 'id'
  | 'legacy_id'
  | 'slug'
  | 'name'
  | 'category'
  | 'profile_photo_url'
  | 'profile_photo_metadata'
  | 'one_liner'
  | 'template_type'
>

export type ArtistPermissionChecker = (
  memberProfile: MemberProfile,
  artistId: string
) => Promise<ArtistPermissionCheck>

export const ARTIST_ROLES = {
  OWNER: 'owner',
  MANAGER: 'manager',
  COLLABORATOR: 'collaborator',
} as const

export const TEMPLATE_TYPES = {
  MINIMAL: '미니멀형',
  COLLAGE: '콜라주형',
} as const

export function isArtist(obj: any): obj is Artist {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.oneLiner === 'string' &&
    typeof obj.bio === 'string'
  )
}

export function isDatabaseArtist(obj: any): obj is DatabaseArtist {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.legacy_id === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.category) &&
    typeof obj.template_type === 'string'
  )
}
