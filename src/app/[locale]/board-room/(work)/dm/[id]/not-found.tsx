import Link from '@work/lib/nav/link'
import { UserIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { EmptyState } from '@work/components/layout/page'

/** 원본 `app/(app)/dm/[id]/not-found.tsx` */
export default function BoardWorkDmNotFound() {
  return (
    <EmptyState
      as="h1"
      icon={UserIcon}
      title="대화를 찾을 수 없습니다"
      description="대화가 없거나 참여하지 않은 대화입니다."
    >
      <Link href="/chat?new=1" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        새 대화 시작하기
      </Link>
    </EmptyState>
  )
}
