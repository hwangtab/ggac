import type { Metadata } from 'next'
import Link from '@work/lib/nav/link'
import { ArrowLeftIcon } from 'lucide-work'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { listNotifyLevelOverrides } from '@/db/queries/work/channels'
import { buttonVariants } from '@work/components/ui/button'
import { chatKindLabel } from '@work/lib/channels/group'
import { getMyPrefs } from '@work/lib/notifications/prefs'
import { NOTIFY_LEVEL_LABEL, effectiveNotifyLevel } from '@work/lib/notifications/levels'
import { PageBody, PageHeader, SectionHeading } from '@work/components/layout/page'
import NotificationPrefsForm from '@work/components/notifications/NotificationPrefsForm'
import PushSubscribeButton from '@work/components/push/PushSubscribeButton'
import { getVapidPublicKey } from '@work/lib/push/send'

export const metadata: Metadata = { title: '알림 설정' }

/**
 * 알림 설정 — 원본 `app/(app)/settings/notifications/page.tsx`.
 * ggac 이식: 푸시 알림(PushSubscribeButton)은 5단계에서 옮겼다. VAPID 공개키는 서버가 넘긴다 — 비공개키까지 설정돼
 * 실제로 보낼 수 있을 때만 켤 수 있다(없으면 "준비되지 않음"). 첫 사용 안내 다시 보기는 안내(OnboardingGate)를 옮길 때 함께 둔다.
 * "알림 수준을 바꾼 대화"는 **내 멤버십만** 읽는다(가드의 사용자 id).
 */
export default async function BoardWorkNotificationSettingsPage() {
  const ctx = await requireWorkStaff()
  const [prefs, changed] = await Promise.all([
    getMyPrefs(ctx, ctx.user.id),
    listNotifyLevelOverrides(ctx.user.id),
  ])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        variant="page"
        title="알림 설정"
        hideOnMobile
        actions={
          <Link href="/settings" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <ArrowLeftIcon aria-hidden="true" />
            설정으로 돌아가기
          </Link>
        }
      />
      <PageBody width="narrow">
        <section aria-labelledby="notif-push" className="space-y-3">
          <SectionHeading id="notif-push">푸시 알림</SectionHeading>
          <p className="text-xs text-muted-foreground">
            기기마다 따로 켭니다. 기본으로는 멘션, 다이렉트 메시지, 내가 참여한 스레드의 새 답글이
            오면 알려 줍니다. 대화마다 &ldquo;모든 새 글 / 멘션만 / 끔&rdquo;을 고를 수 있고, 내가
            쓴 메시지와 알림을 끈 대화의 알림은 오지 않습니다. 방해 금지 시간에는 보내지 않습니다.
          </p>
          <PushSubscribeButton publicKey={getVapidPublicKey()} />
        </section>

        <section aria-labelledby="notif-prefs" className="space-y-3">
          <h2 id="notif-prefs" className="sr-only">
            방해 금지와 메일 알림
          </h2>
          <NotificationPrefsForm initialQuiet={prefs.quiet} initialDigestMode={prefs.digestMode} />
        </section>

        <section aria-labelledby="notif-mute" className="space-y-3">
          <SectionHeading id="notif-mute">알림 수준을 바꾼 대화</SectionHeading>
          <p className="text-xs text-muted-foreground">
            채널·대화 머리글의 종 모양 단추(&ldquo;알림 설정&rdquo;)에서 &ldquo;모든 새 글&rdquo;,
            &ldquo;멘션만&rdquo;, &ldquo;끔&rdquo; 중에 고릅니다. 끔은 푸시·메일·활동 알림이 모두
            멈추고 사이드바 배지가 흐려집니다. 기본값은 채널은 멘션만, 다이렉트 메시지와 그룹 채팅은
            모든 새 글입니다.
          </p>
          {changed.length === 0 ? (
            <p className="text-sm text-muted-foreground">기본값에서 바꾼 대화가 없습니다.</p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-w-lg border bg-card text-sm">
              {changed.map(m => {
                const ch = m.channel
                const href =
                  ch.kind === 'dm' || !ch.slug
                    ? `/dm/${m.channel_id}`
                    : `/c/${encodeURIComponent(ch.slug)}`
                const level = effectiveNotifyLevel(
                  m.notify_level as Parameters<typeof effectiveNotifyLevel>[0],
                  ch.kind
                )
                return (
                  <li key={m.channel_id} className="px-4 py-3">
                    <Link href={href} className="underline underline-offset-2">
                      {ch.kind === 'dm' ? chatKindLabel(ch.name) : `# ${ch.name}`}
                    </Link>
                    <span className="text-muted-foreground"> · {NOTIFY_LEVEL_LABEL[level]}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </PageBody>
    </div>
  )
}
