/**
 * 지원사업 회차 발행 — 게시글 → 인앱 알림 → 이메일.
 *
 * 의존성을 전부 주입받는다. 그래야 "메일 한 통이 실패했을 때 나머지가 계속 나가는가",
 * "알림이 실패해도 발행이 되돌아가지 않는가" 같은 조건을 네트워크 없이 고정할 수 있다
 * (`src/lib/payments/billingRun.ts`와 같은 배치).
 *
 * 로컬 import는 `.ts`를 명시한다 — `node --test`의 타입 스트리핑 모드 제약.
 */
import type { GrantItem } from '../../db/queries/grantDigests.ts'
import {
  activeItems,
  kstTodayIso,
  renderDigestEmail,
  renderDigestMarkdown,
  renderDigestNotification,
  CAP,
} from './grantDigest.ts'
import { effectiveInterests, matchesInterests } from './interestMatch.ts'

/** `getUserSettings`가 돌려주는 행의 필요한 부분만. */
export interface SettingLike {
  category: string
  setting_key: string
  setting_value: unknown
}

export interface PublishMember {
  id: string
  email: string | null
  display_name: string | null
  /** 빈 배열이면 조합 기본값. `effectiveInterests`가 해석한다. */
  interest_genres: string[]
  interest_regions: string[]
}

export interface PublishDigest {
  id: string
  week_key: string
  items: GrantItem[]
  status: string
}

export interface GrantPublishResult {
  post_id: string
  notified: number
  notification_failed: boolean
  email_sent: number
  email_failed: number
  /** 조합원이 이메일 수신을 껐다. */
  email_skipped_optout: number
  /** 주소가 없거나 형식이 깨졌다. */
  email_skipped_address: number
  /**
   * 관심사와 겹치는 공고가 0건이었다.
   *
   * **이 사유만 따로 세는 이유**: 앞의 둘은 사람이 선택했거나 데이터가 깨진 것이고,
   * 이것은 **우리 필터가 만든 결과**다. kosmart는 지역을 AND로 바꾼 뒤 210명이 카드
   * 0장을 받는 상태를 한동안 몰랐다 — 아무것도 못 받은 사람은 항의하지 않는다.
   */
  email_skipped_nomatch: number
  /** `email_skipped_nomatch`와 같은 값. 관리자 화면이 읽는 이름. */
  zero_match_count: number
  /** 실패한 주소(마스킹됨)와 사유. 관리자 화면에 그대로 보여준다. */
  email_errors: { to: string; error: string }[]
}

export interface RunGrantPublishInput {
  digest: PublishDigest
  /** 게시글 작성자 = 발행 버튼을 누른 관리자. */
  authorId: string
  /** 승인·활성 조합원. 알림은 전원, 메일은 여기서 다시 거른다. */
  members: PublishMember[]
  /** userId → 그 회원의 설정 행들. 없으면 미설정으로 본다. */
  settingsByUserId: Map<string, SettingLike[]>
  siteUrl: string
  now: Date
  createPost: (input: {
    title: string
    content: string
    content_format: string
    category: string
    author_id: string
    is_pinned: boolean
  }) => Promise<{ id: string }>
  createBulkNotifications: (input: {
    user_ids: string[]
    type: string
    title: string
    message: string
    data?: Record<string, unknown>
    expires_at?: string | null
    related_post_id?: string | null
  }) => Promise<number>
  sendEmail: (input: {
    to: string
    subject: string
    html: string
    headers?: Record<string, string>
  }) => Promise<void>
  log: { info: (msg: string, meta?: unknown) => void; error: (msg: string, meta?: unknown) => void }
}

const NOTIFICATION_EXPIRY_DAYS = 30

/**
 * 이 회원이 이메일 수신을 껐는가.
 *
 * `user_settings.setting_value`는 JSON 컬럼이라 `false`가 불리언으로도 문자열로도
 * 들어올 수 있다(UI가 저장하는 경로와 기본값 경로가 다르다). 둘 다 거부로 읽는다.
 * **미설정(행 없음)은 거부가 아니다** — 조합원이 명시적으로 끈 것만 존중한다.
 */
export function isEmailOptedOut(settings: SettingLike[] | undefined): boolean {
  if (!settings) return false
  const row = settings.find(
    s => s.category === 'notification' && s.setting_key === 'email_notifications'
  )
  if (!row) return false
  return row.setting_value === false || row.setting_value === 'false'
}

/** 보낼 수 있는 주소인가. 공백·형식 오류는 건너뛴다 — 주소를 추측해서 고치지 않는다. */
function isSendableEmail(email: string | null): email is string {
  if (!email) return false
  const trimmed = email.trim()
  if (trimmed !== email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** 로그에 주소를 통째로 남기지 않는다. */
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 1) return '***'
  return `${email.slice(0, 2)}***${email.slice(at)}`
}

export async function runGrantPublish(input: RunGrantPublishInput): Promise<GrantPublishResult> {
  const { digest, members, log } = input
  const todayIso = kstTodayIso(input.now)
  const active = activeItems(digest.items)

  // ① 게시글. 실패하면 던진다 — 게시글이 없으면 알림이 가리킬 곳이 없다.
  const content = renderDigestMarkdown(digest.items, digest.week_key, todayIso)
  const post = await input.createPost({
    title: `[지원사업] ${digest.week_key} ${active.length}건`,
    content,
    content_format: 'markdown',
    category: '지원사업',
    author_id: input.authorId,
    // 매주 올라오므로 고정하지 않는다 — 고정하면 공지가 밀린다.
    is_pinned: false,
  })

  // ② 인앱 알림. 실패해도 발행을 되돌리지 않는다 — 게시글은 이미 올라갔다.
  const notification = renderDigestNotification(digest.items, digest.week_key)
  const userIds = members.map(m => m.id)
  let notified = 0
  let notificationFailed = false
  try {
    notified = await input.createBulkNotifications({
      user_ids: userIds,
      type: 'system_notice',
      title: notification.title,
      message: notification.message,
      data: { weekKey: digest.week_key, digestId: digest.id, count: active.length },
      expires_at: new Date(
        input.now.getTime() + NOTIFICATION_EXPIRY_DAYS * 86_400_000
      ).toISOString(),
      related_post_id: post.id,
    })
  } catch (error) {
    notificationFailed = true
    log.error('지원사업 알림 생성 실패', {
      digestId: digest.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // ③ 이메일. 18통 규모라 순차로 보낸다 — 레이트리밋·배치 드레인이 필요 없다.
  const settingsUrl = `${input.siteUrl}/ko/mypage/settings`

  let sent = 0
  let failed = 0
  let skippedOptout = 0
  let skippedAddress = 0
  let skippedNoMatch = 0
  const errors: { to: string; error: string }[] = []

  for (const m of members) {
    if (isEmailOptedOut(input.settingsByUserId.get(m.id))) {
      skippedOptout += 1
      continue
    }
    if (!isSendableEmail(m.email)) {
      skippedAddress += 1
      continue
    }

    // 이 회원의 관심사로 풀을 거른다. 미설정이면 조합 기본값이 적용된다.
    const interests = effectiveInterests(m)
    const mine = active.filter(it => matchesInterests(it, interests)).slice(0, CAP)

    if (mine.length === 0) {
      // 빈 메일은 노이즈다. 게시글과 인앱 알림은 이미 갔으므로 이 회원도 볼 것은 있다.
      skippedNoMatch += 1
      continue
    }

    const { subject, html } = renderDigestEmail(mine, digest.week_key, todayIso, settingsUrl)

    try {
      await input.sendEmail({
        to: m.email,
        subject,
        html,
        headers: { 'List-Unsubscribe': `<${settingsUrl}>` },
      })
      sent += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ to: maskEmail(m.email), error: message.slice(0, 200) })
      log.error('지원사업 메일 발송 실패', { to: maskEmail(m.email), error: message })
    }
  }

  log.info('지원사업 발행 완료', {
    digestId: digest.id,
    postId: post.id,
    notified,
    sent,
    failed,
    skippedOptout,
    skippedAddress,
    skippedNoMatch,
  })

  return {
    post_id: post.id,
    notified,
    notification_failed: notificationFailed,
    email_sent: sent,
    email_failed: failed,
    email_skipped_optout: skippedOptout,
    email_skipped_address: skippedAddress,
    email_skipped_nomatch: skippedNoMatch,
    zero_match_count: skippedNoMatch,
    email_errors: errors,
  }
}
