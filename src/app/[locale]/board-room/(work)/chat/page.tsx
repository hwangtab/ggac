import { Link } from '@/i18n/navigation'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { buttonVariants } from '@work/components/ui/button'

/** 0단계 빈 화면 — 가드가 넘겨 준 사람과 UI 키트(버튼·토큰)가 제대로 칠해지는지만 보인다. 1단계에서 원본 `chat/page.tsx`로 바꾼다. */
export default async function BoardWorkChatPage() {
  const { staff } = await requireWorkStaff()

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
      <h1 className="font-heading text-xl font-semibold">이사회 업무툴</h1>
      <p className="text-sm text-muted-foreground" data-testid="board-work-staff">
        {staff.display_name}
        {staff.title ? ` · ${staff.title}` : ''} · {staff.role === 'admin' ? '관리자' : '구성원'}
      </p>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        채팅·자료실·편집기를 옮기는 중입니다.
      </p>
      <Link href="/board-room" className={buttonVariants({ variant: 'outline' })}>
        이사회실로
      </Link>
    </main>
  )
}
