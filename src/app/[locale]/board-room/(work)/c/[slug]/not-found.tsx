import Link from '@work/lib/nav/link'
import { HashIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { EmptyState } from '@work/components/layout/page'

/** 원본 `app/(app)/c/[slug]/not-found.tsx` */
export default function BoardWorkChannelNotFound() {
  return (
    <EmptyState
      as="h1"
      icon={HashIcon}
      title="채널을 찾을 수 없습니다"
      description="채널이 없거나 볼 권한이 없습니다. 비공개 채널이면 채널 멤버에게 초대를 부탁하세요."
    >
      <Link href="/c" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        채널 찾아보기
      </Link>
    </EmptyState>
  )
}
