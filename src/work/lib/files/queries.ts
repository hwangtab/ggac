import {
  getAttachmentWithMessage,
  listFileRecords,
  listFileUploaders,
  listFilterChannels,
  type FileListRecord,
} from '@/db/queries/work/files'
import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { kstDayEnd, kstDayStart } from './format'
import { isSafeAttachmentPath } from './paths'
import type { Attachment, FilesSearch } from './schema'

/**
 * 자료실·첨부 조회(서버 전용) — 원본 kosmart-work `lib/files/queries.ts`와 **같은 이름·결과 모양**.
 * 원본은 RLS 클라이언트가 읽을 수 없는 채널(can_read_channel)을 걸렀다. 여기서는 첫 인자(가드 결과)로 읽기 범위
 * (원본 readable_channel_ids)를 계산해 쿼리 계층에 **명시적으로** 넘긴다(설계 §5).
 *
 * 원본과 다른 점: 파일명 검색은 pgroonga 가 아니라 `LIKE`다(설계 §8-3 — 1단계 검색과 같은 결정). 그래서 후보 id 를
 * 먼저 자르고 필터를 거는 경로(searchIds·latestIdsOfLineages)가 없다.
 */

/** 자료실 한 페이지 크기 */
export const FILES_PAGE_SIZE = 48

export type FileListItem = FileListRecord

export { escapeLike } from '@/db/queries/work/files'

/** 채널 파일 탭 전용 옵션(자료실은 쓰지 않는다) */
export type ListFilesOptions = {
  /** 폴더 한정: ''(루트) = folder_path is null, 그 밖에는 정확히 같은 폴더(하위 폴더 제외) */
  folder?: string
  /** 정렬(기본: 최신순). id 가 항상 동률을 깬다 */
  sort?: { column: 'name' | 'created_at' | 'size'; ascending: boolean }
  pageSize?: number
  /** 원본: pgroonga 대신 ilike 로만 찾기. ggac 는 늘 LIKE 라 의미가 없다(호환용으로 받는다) */
  plainNameSearch?: boolean
}

async function scope(supabase: WorkServerClient) {
  return readableChannelIds(viewerOf(supabase))
}

export async function listFiles(
  supabase: WorkServerClient,
  search: FilesSearch,
  opts: ListFilesOptions = {}
): Promise<{ items: FileListItem[]; total: number; hasMore: boolean; pageSize: number }> {
  const pageSize = opts.pageSize ?? FILES_PAGE_SIZE
  const from = (search.page - 1) * pageSize
  const rows = await listFileRecords({
    readable: await scope(supabase),
    channelId: search.channel,
    uploaderId: search.uploader,
    from: search.from ? kstDayStart(search.from) : undefined,
    to: search.to ? kstDayEnd(search.to) : undefined,
    kind: search.kind,
    q: search.q,
    folder: opts.folder,
    allVersions: search.versions === 'all',
    sort: opts.sort,
    offset: from,
    // 정확한 총 개수 대신 한 건 더 읽어 다음 쪽 유무만 안다
    limit: pageSize + 1,
  })
  const hasMore = rows.length > pageSize
  const items = hasMore ? rows.slice(0, pageSize) : rows
  // total 은 "여기까지 확인된 개수" — 마지막 쪽(hasMore=false)에서만 정확한 전체 수다. 화면은 hasMore 면 '이상' 으로 쓴다.
  return { items, total: from + items.length, hasMore, pageSize }
}

export type FileFilterOptions = {
  channels: { id: string; name: string }[]
  uploaders: { user_id: string; display_name: string }[]
}

/**
 * 필터 선택지: 내가 읽을 수 있는 채널(DM 제외)과 올린 사람. 원본은 활성 구성원 전원이었지만, ggac 에는 구성원 표가 없어
 * "읽을 수 있는 채널에 파일을 올린 사람"으로 좁혔다(필터에 아무 결과도 없는 사람을 늘어놓지 않는다).
 */
export async function getFilterOptions(supabase: WorkServerClient): Promise<FileFilterOptions> {
  const readable = await scope(supabase)
  const [channels, uploaders] = await Promise.all([
    listFilterChannels(readable),
    listFileUploaders(readable),
  ])
  return { channels, uploaders }
}

/**
 * 첨부 1건 — 원본과 같은 판정: **읽을 수 있는 채널 + 지워지지 않은 메시지**. 아니면 null(없음과 구분하지 않는다).
 * 파일 열기·내려받기·미리보기 변환 라우트의 접근 통제 핵심이다. 지출결의 예외(allowExpense)는 가져오지 않았다.
 */
export async function getReadableAttachment(
  supabase: WorkServerClient,
  id: string
): Promise<Attachment | null> {
  const row = await getAttachmentWithMessage(id)
  if (!row) return null
  if (row.message_deleted_at) return null
  if (!(await scope(supabase)).has(row.channel_id)) return null
  const { message_deleted_at: _deleted, ...attachment } = row
  // 2중 방어: 경로가 업무툴 파일 키 모양이 아니면(다른 영역을 가리키면) 읽기 대상이 아니다.
  if (!isSafeAttachmentPath(attachment.bucket_path)) {
    console.error('[files] 안전하지 않은 첨부 경로 — 건너뜀:', attachment.id)
    return null
  }
  return attachment
}
