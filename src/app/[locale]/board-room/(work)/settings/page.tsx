import type { Metadata } from 'next'
import Link from '@work/lib/nav/link'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { PageBody, PageHeader, SectionHeading } from '@work/components/layout/page'
import ProfileForm from '@work/components/settings/ProfileForm'
import StatusSetting from '@work/components/settings/StatusSetting'
import { listStaffDirectory } from '@work/lib/channels/queries'
import { activeStatus } from '@work/lib/notifications/status'

export const metadata: Metadata = { title: '설정' }

/**
 * 설정 — 원본 `app/(app)/settings/page.tsx`. ggac 이식: 2단계 인증 절은 뺐다(설계 §3 — 업무툴은 이메일 2단계 인증을
 * 하지 않는다). 표시 이름은 ggac 회원 프로필과 같은 값이고, 직함은 관리자가 정한다(ProfileForm에서 읽기 전용).
 * 상태 메시지는 원본 상단바 계정 메뉴에 있던 것을 여기로 옮겼다(docs/board-work/03-통합-재설계.md §2-3).
 */
export default async function BoardWorkSettingsPage() {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const directory = await listStaffDirectory(ctx)
  const myStatus = activeStatus(directory.find(s => s.user_id === user.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        variant="page"
        title="설정"
        subtitle={`${user.email ?? ''} · ${staff.role === 'admin' ? '관리자' : '이사회 구성원'}`}
      />
      <PageBody width="narrow">
        <section aria-labelledby="settings-profile" className="space-y-3">
          <SectionHeading id="settings-profile">프로필</SectionHeading>
          <div className="rounded-w-lg border bg-card p-4">
            <ProfileForm displayName={staff.display_name} title={staff.title} />
          </div>
        </section>

        <section aria-labelledby="settings-status" className="space-y-3">
          <SectionHeading id="settings-status">상태 메시지</SectionHeading>
          <div className="rounded-w-lg border bg-card p-4">
            <StatusSetting current={myStatus} />
          </div>
        </section>

        <section aria-labelledby="settings-notifications" className="space-y-3">
          <SectionHeading id="settings-notifications">알림</SectionHeading>
          <p className="text-xs text-muted-foreground">
            방해 금지 시간과 대화별 알림 수준을 확인합니다.{' '}
            <Link href="/settings/notifications" className="underline underline-offset-2">
              알림 설정 열기
            </Link>
          </p>
        </section>
      </PageBody>
    </div>
  )
}
