import Link from '@work/lib/nav/link'
import { cn } from '@work/lib/utils'
import { BOARD_FOLDERS, boardFolderHref } from '@work/lib/files/board-folders'

/**
 * 좁은 화면(lg 미만)의 '이사회 서류' 폴더 줄 — 넓은 화면에서는 목록 칸(FilesPaneContent)이 같은 일을 한다.
 * 좁은 화면의 자료실은 목록 칸이 접혀 있어(메일함과 같은 목록 → 상세) 이것이 없으면 분류로 갈 길이 없다.
 */
export default function BoardFolderNav({ active }: { active: string | null }) {
  return (
    <nav aria-label="이사회 서류 폴더" className="flex flex-wrap items-center gap-1.5 lg:hidden">
      <span className="mr-1 text-xs font-semibold text-muted-foreground">이사회 서류</span>
      {BOARD_FOLDERS.map(category => (
        <Link
          key={category}
          href={boardFolderHref(category)}
          aria-current={active === category ? 'page' : undefined}
          className={cn(
            'inline-flex h-7 pointer-coarse:h-11 items-center rounded-w-lg border px-2.5 text-xs outline-none hover:bg-accent',
            active === category && 'bg-subtle font-semibold text-foreground'
          )}
        >
          {category}
        </Link>
      ))}
      {active && (
        <Link
          href="/files"
          className="inline-flex h-7 pointer-coarse:h-11 items-center rounded-w-lg px-2 text-xs text-muted-foreground underline-offset-2 outline-none hover:underline"
        >
          대화 첨부
        </Link>
      )}
    </nav>
  )
}
