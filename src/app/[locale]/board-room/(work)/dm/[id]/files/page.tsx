import { notFound, redirect } from 'next/navigation'
import { uuidSchema } from '@work/lib/channels/schema'

export const dynamic = 'force-dynamic'

/**
 * DM·그룹 "파일" 탭 주소 — 원본 `app/(app)/dm/[id]/files/page.tsx`. 원본은 2단계에서 "공유됨"(/dm/<id>/shared)으로
 * 바뀌었고 이 주소는 옮겨 준다(권한 확인은 도착 페이지의 가드가 한다).
 */
export default async function BoardWorkDmFilesRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const parsed = uuidSchema.safeParse((await params).id)
  if (!parsed.success) notFound()
  redirect(`/board-room/dm/${parsed.data}/shared`)
}
