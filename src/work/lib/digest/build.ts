import { APP_NAME_SHORT } from '../brand.ts'
import { formatDateTime } from '../format/datetime.ts'
import { authorLabel } from '../messages/author-label.ts'
import { chatKindLabel } from '../channels/group.ts'
import { messageLink } from '../messages/anchor.ts'
import { toPlainText } from '../search/text.ts'

/**
 * 멘션·DM 다이제스트 메일 본문 — 원본 kosmart-work `lib/digest/build.ts`(순수). `node --test`가 직접 읽는다.
 *
 * 담는 것(원본의 개인정보 판단 그대로): 종류(멘션·DM), 채널 이름(DM은 "다이렉트 메시지"·"그룹 채팅"), 작성자 표시 이름,
 * 시각, 본문 앞 140자, 메시지 링크. **민감 표시 메시지는 본문을 싣지 않는다**. 첨부 이름·스레드의 다른 글·다른 사람의
 * 멘션은 싣지 않는다. 한 통에 20건까지(나머지는 "외 n건").
 * ggac 이식: 링크는 `/board-room/...`(messageLink), 알림 설정 주소는 `/board-room/settings/notifications`.
 */

/** 다이제스트 후보 한 행(쿼리 계층 listDigestCandidates를 메일에 필요한 열로 줄인 것). */
export type DigestCandidate = {
  recipient_id: string
  kind: string
  message_id: string
  channel_id: string
  channel_name: string
  channel_slug: string | null
  channel_kind: string
  author_name: string | null
  /** work_messages.kind — 봇·시스템 작성자 라벨 규칙(author-label.ts) */
  message_kind?: string
  /** 스레드 답글이면 부모 메시지 id(링크가 스레드 패널을 연다) */
  parent_id?: string | null
  body: string
  sensitive: boolean
  created_at: string | Date
}

export type DigestEmail = { subject: string; html: string; text: string; count: number }

const MAX_ITEMS = 20
const SNIPPET_MAX = 140

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function snippetOf(row: Pick<DigestCandidate, 'body' | 'sensitive'>): string {
  if (row.sensitive) return '민감 정보가 포함된 메시지입니다. 앱에서 확인하세요.'
  const plain = toPlainText(row.body)
  if (!plain) return '(첨부 파일)'
  return plain.length > SNIPPET_MAX ? `${plain.slice(0, SNIPPET_MAX)}…` : plain
}

export function candidateUrl(siteUrl: string, row: DigestCandidate): string {
  const base = siteUrl.replace(/\/+$/, '')
  return `${base}${messageLink({
    channelId: row.channel_id,
    kind: row.channel_kind,
    slug: row.channel_slug,
    messageId: row.message_id,
    parentId: row.parent_id,
  })}`
}

function whenKst(iso: string | Date): string {
  return formatDateTime(iso)
}

/** 작성자 표시: 사람은 이름, 봇은 "<본문의 **[이름]**> (봇)", 시스템은 "시스템"(author-label.ts). */
export function authorOf(row: DigestCandidate): string {
  return authorLabel({ kind: row.message_kind, authorName: row.author_name, body: row.body })
}

function placeLabel(row: DigestCandidate): string {
  return row.channel_kind === 'dm' ? chatKindLabel(row.channel_name) : `#${row.channel_name}`
}

/** 한 사용자에게 보낼 다이제스트 메일(한국어). rows 는 created_at 오름차순 가정. */
export function buildDigestEmail(
  rows: readonly DigestCandidate[],
  siteUrl: string
): DigestEmail | null {
  if (rows.length === 0) return null
  const mentions = rows.filter(r => r.kind === 'mention').length
  const dms = rows.length - mentions
  const parts = [
    mentions > 0 && `멘션 ${mentions}건`,
    dms > 0 && `다이렉트 메시지 ${dms}건`,
  ].filter(Boolean)
  const subject = `[${APP_NAME_SHORT}] 읽지 않은 ${parts.join(' · ')}`

  const shown = rows.slice(0, MAX_ITEMS)
  const rest = rows.length - shown.length
  const base = siteUrl.replace(/\/+$/, '')

  const items = shown
    .map(r => {
      const url = candidateUrl(siteUrl, r)
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
<div style="font-size:12px;color:#6b7280;">${esc(r.kind === 'mention' ? '멘션' : '다이렉트 메시지')} · ${esc(placeLabel(r))} · ${esc(whenKst(r.created_at))}</div>
<div style="font-size:14px;margin-top:2px;"><strong>${esc(authorOf(r))}</strong></div>
<div style="font-size:14px;color:#374151;margin-top:2px;">${esc(snippetOf(r))}</div>
<div style="margin-top:6px;"><a href="${esc(url)}" style="color:#0e7490;font-size:13px;">메시지 열기</a></div>
</td></tr>`
    })
    .join('\n')

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827;">
<div style="max-width:560px;margin:0 auto;">
<h1 style="font-size:18px;margin:0 0 4px;">읽지 않은 ${esc(parts.join(' · '))}이 있습니다</h1>
<p style="font-size:13px;color:#6b7280;margin:0 0 12px;">한동안 확인하지 않은 알림을 모아 보냈습니다.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items}</table>
${rest > 0 ? `<p style="font-size:13px;color:#6b7280;">외 ${rest}건은 앱에서 확인하세요.</p>` : ''}
<p style="margin-top:16px;"><a href="${esc(base)}/board-room/chat" style="color:#0e7490;">${esc(APP_NAME_SHORT)} 열기</a></p>
<p style="font-size:12px;color:#9ca3af;margin-top:24px;">채널을 뮤트하면 해당 채널 알림은 오지 않습니다. 메일 알림은 설정에서 끌 수 있습니다: ${esc(base)}/board-room/settings/notifications</p>
</div></body></html>`

  const text = [
    `읽지 않은 ${parts.join(' · ')}이 있습니다 (한동안 확인하지 않은 알림).`,
    '',
    ...shown.map(
      r =>
        `[${r.kind === 'mention' ? '멘션' : 'DM'}] ${placeLabel(r)} · ${authorOf(r)} · ${whenKst(r.created_at)}\n${snippetOf(r)}\n${candidateUrl(siteUrl, r)}\n`
    ),
    rest > 0 ? `외 ${rest}건은 앱에서 확인하세요.` : '',
    `${base}/board-room/chat`,
    `메일 알림은 설정에서 끌 수 있습니다: ${base}/board-room/settings/notifications`,
  ]
    .filter(l => l !== undefined)
    .join('\n')

  return { subject, html, text, count: rows.length }
}
