import type { WorkServerClient } from '@work/lib/supabase/server'
import { listFiles, type FileListItem } from '@work/lib/files/queries'
import { filesSearchSchema } from '@work/lib/files/schema'
import type { ChannelLinks } from './links'
import { loadChannelLinks } from './links-load'

/** 공유됨 탭 한 구역에 보여 줄 최대 개수 */
export const SHARED_PHOTOS_LIMIT = 60
export const SHARED_FILES_LIMIT = 100

export type SharedData = {
  /** 이미지 첨부(최신순) */
  photos: FileListItem[]
  photosTotal: number
  /** 최근 SHARED_PHOTOS_LIMIT 장보다 더 있는가 */
  photosHasMore: boolean
  /** 이미지가 아닌 첨부(최신순) */
  files: FileListItem[]
  /** 최근 SHARED_FILES_LIMIT 개보다 더 있는가(이미지 포함 전체 기준) */
  filesHasMore: boolean
  /** 메시지에서 공유된 링크(0025 message_links, 최신순) */
  links: ChannelLinks
}

/**
 * DM·그룹 "공유됨" 탭 데이터(파일·사진·링크). 권한은 읽기 범위(원본 RLS can_read_channel)가 정하고 채널 id 로 좁히기만 한다.
 * 파일 구역은 최근 첨부에서 이미지를 뺀 목록이다(사진은 따로 격자로 보인다).
 */
export async function loadSharedData(
  supabase: WorkServerClient,
  channelId: string
): Promise<SharedData> {
  const search = filesSearchSchema.parse({ channel: channelId })
  const [photos, files, links] = await Promise.all([
    listFiles(supabase, { ...search, kind: 'image' }, { pageSize: SHARED_PHOTOS_LIMIT }),
    listFiles(supabase, search, { pageSize: SHARED_FILES_LIMIT }),
    loadChannelLinks(supabase, { id: channelId, kind: 'dm', slug: null }),
  ])
  return {
    photos: photos.items,
    photosTotal: photos.total,
    photosHasMore: photos.hasMore,
    files: files.items.filter(f => !f.mime.startsWith('image/')),
    filesHasMore: files.hasMore,
    links,
  }
}
