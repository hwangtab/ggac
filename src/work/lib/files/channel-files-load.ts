import { listSubfolderCounts } from '@/db/queries/work/files'
import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'
import {
  CHANNEL_FILES_PAGE_SIZE,
  toChannelFolders,
  type ChannelFilesData,
  type ChannelFilesSearch,
} from './channel-files'
import { listFiles } from './queries'
import { filesSearchSchema } from './schema'

// ggac 이식: 원본 `lib/files/channel-files.ts`의 loadChannelFiles(서버 전용)를 따로 뺐다 — 같은 파일의 링크·파싱 함수는
// 클라이언트 컴포넌트도 쓰는데, 이 함수가 DB 쿼리 계층을 끌어오면 브라우저 번들에 libsql 이 들어간다.

/**
 * 채널 파일 탭 데이터. 권한은 읽기 범위(원본 RLS can_read_channel)가 정하고, 이 함수는 채널 id 로 좁히기만 한다.
 * - 검색어가 있으면 폴더를 무시하고 채널 전체에서 이름으로 찾는다(Teams 파일 탭과 같은 동작).
 * - 정렬은 파일만 — 폴더 행은 항상 이름순으로 파일 앞에 둔다.
 */
export async function loadChannelFiles(
  supabase: WorkServerClient,
  channelId: string,
  search: ChannelFilesSearch
): Promise<ChannelFilesData> {
  const searching = Boolean(search.q)
  const base = filesSearchSchema.parse({
    channel: channelId,
    q: search.q,
    page: search.page,
    versions: search.versions,
  })
  const [list, folderRows] = await Promise.all([
    listFiles(supabase, base, {
      folder: searching ? undefined : search.path,
      sort: {
        column: search.sort === 'date' ? 'created_at' : search.sort,
        ascending: search.dir === 'asc',
      },
      pageSize: CHANNEL_FILES_PAGE_SIZE,
      plainNameSearch: true,
    }),
    searching || search.page > 1
      ? Promise.resolve([])
      : // ggac 이식: 원본 RPC channel_subfolders(security invoker → RLS) 자리 — 읽기 범위를 명시적으로 넘긴다
        readableChannelIds(viewerOf(supabase)).then(readable =>
          listSubfolderCounts(channelId, search.path, readable)
        ),
  ])
  const folders = toChannelFolders(folderRows, search.path)
  return { ...list, folders }
}
