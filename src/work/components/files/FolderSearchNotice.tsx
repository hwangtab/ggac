import Link from '@work/lib/nav/link'
import { NoticeBanner } from '@work/components/layout/page'
import { InfoIcon } from 'lucide-work'
import { filesFolderHref } from '@work/lib/files/channel-files'
import { folderCrumbs } from '@work/lib/files/folders'

/**
 * 폴더 안에서 검색·필터를 걸면 폴더(path)를 무시하고 채널 전체에서 찾는다(의도) — 그 사실을 화면에 알리고
 * 폴더 탐색으로 돌아가는 링크를 둔다.
 */
export default function FolderSearchNotice({
  channelId,
  channelName,
  path,
}: {
  channelId: string
  channelName: string
  path: string
}) {
  const leaf = folderCrumbs(path).at(-1)?.name ?? path
  return (
    <NoticeBanner icon={InfoIcon}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          &lsquo;{leaf}&rsquo; 폴더가 아니라 # {channelName} 전체에서 찾았습니다.
        </span>
        <Link
          href={filesFolderHref(channelId, { path })}
          className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
        >
          폴더로 돌아가기
        </Link>
      </span>
    </NoticeBanner>
  )
}
