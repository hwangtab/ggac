import Link from '@work/lib/nav/link'
import { ShieldAlertIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { EmptyState } from '@work/components/layout/page'

/** 편집 화면 진입 거절 안내(`/board-room/edit/[attachmentId]`·`/board-room/edit/new` 공용) — 원본 `app/edit/denied.tsx` */
export default function Denied({ message }: { message: string }) {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh flex-col"
      data-testid="board-work-edit-denied"
    >
      <EmptyState icon={ShieldAlertIcon} as="h1" title={message}>
        <Link href="/files" className={buttonVariants({ size: 'sm' })}>
          자료실로
        </Link>
      </EmptyState>
    </main>
  )
}
