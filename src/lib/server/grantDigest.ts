/**
 * 예술지원사업 주간 회차의 판정과 렌더링.
 *
 * **순수 함수만 둔다** — 네트워크·DB 접근이 없다. 그래야 중복 발송·주차 경계·이스케이프
 * 같은 것을 `node --test`로 전수 고정할 수 있다(`src/lib/payments/billingRun.ts`와 같은 배치).
 *
 * 로컬 import는 타입만 쓴다 — `node --test`의 타입 스트리핑 모드는 확장자 없는 로컬
 * import를 해석하지 못하므로 `.ts`를 명시한다.
 */
import type { GrantItem } from '../../db/queries/grantDigests.ts'

/** 조합이 다루는 장르. kosmart `taxonomy.ts:11 STANDARD_GENRES`의 값과 같아야 한다. */
export const DIGEST_GENRES = ['음악'] as const

/** 조합원 활동 지역. '전국'/'전체' 공고는 kosmart가 지역 무관으로 통과시킨다. */
export const DIGEST_REGIONS = ['경기', '서울'] as const

/**
 * 마감이 오늘부터 이 일수 안에 있는 공고만 받는다.
 *
 * 90인 이유: kosmart 실측으로 7일 창을 쓰던 시절 "마감 30일 이상 남은 73건 중
 * 61건(84%)이 창 밖"이었다. 마감이 두 달 뒤인 공고를 지금 알리는 편이 조합원에게 이득이다.
 */
export const WINDOW_DAYS = 90

/** 한 회차에 담을 공고 수 상한. */
export const CAP = 12

/** 중복 제거에 볼 과거 회차 수. */
export const DEDUPE_WEEKS = 12

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** KST 기준 오늘(YYYY-MM-DD). */
export function kstTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * KST 기준 ISO 주차 `'YYYY-Www'`.
 *
 * UTC로 판정하면 안 된다 — 크론이 일요일 23:00 UTC(= 월요일 08:00 KST)에 도는데,
 * UTC 기준으로는 아직 지난 주차다. 그러면 월요일 발행분이 지난 주 회차에 덮어써진다.
 */
export function weekKey(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  // ISO 주차: 그 주 목요일이 속한 해의 주차다.
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()))
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay() // 월=1 … 일=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // 그 주 목요일로 이동
  const year = d.getUTCFullYear()
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * kosmart가 준 목록에서 최근 회차에 이미 담긴 것을 빼고 CAP까지 남긴다.
 *
 * **순서를 다시 정렬하지 않는다** — kosmart가 `rankAndCap`으로 이미 점수순·마감임박순으로
 * 정렬해서 보낸다. 여기서 다시 정렬하면 그 규칙을 두 곳에 두게 된다.
 */
export function buildDraftItems(
  fetched: GrantItem[],
  sentKeys: Set<string>,
  cap: number = CAP
): GrantItem[] {
  const out: GrantItem[] = []
  const seen = new Set<string>()
  for (const it of fetched) {
    if (sentKeys.has(it.key)) continue
    if (seen.has(it.key)) continue // 같은 응답 안의 중복
    seen.add(it.key)
    out.push(it)
    if (out.length >= cap) break
  }
  return out
}

/** 관리자가 제외하지 않은 항목만. */
export function activeItems(items: GrantItem[]): GrantItem[] {
  return items.filter(i => !i.excluded)
}

/**
 * 마감까지 남은 날. 마감이 없으면 `'상시'`다 — **날짜를 지어내지 않는다.**
 */
export function dDay(applyEnd: string | null, todayIso: string): string {
  if (!applyEnd) return '상시'
  const end = Date.parse(`${applyEnd}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  if (!Number.isFinite(end) || !Number.isFinite(today)) return '상시'
  const days = Math.round((end - today) / 86_400_000)
  if (days < 0) return '마감'
  if (days === 0) return 'D-day'
  return `D-${days}`
}

/**
 * 마크다운 제어문자를 막는다 — 대괄호·역슬래시(링크 문법 `[텍스트](url)`가 깨지지 않게),
 * `*`·`_`·백틱(외부 기관 텍스트에 섞여 들어와 의도치 않게 강조·코드로 서식화되지 않게).
 */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\[\]*_`])/g, '\\$1')
}

/** HTML 특수문자를 막는다. `src/lib/auth/email.ts:20`과 같은 목록. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function tagLine(it: GrantItem): string {
  const tags = [...it.regions, ...it.genres]
  if (it.biz_type) tags.push(it.biz_type)
  return tags.join(' · ')
}

/**
 * 게시글 본문(마크다운).
 *
 * 항목이 0건이어도 본문을 만든다 — 빈 문자열은 게시글로 만들 수 없고(`content` NOT NULL),
 * "이번 주는 없었다"는 것 자체가 조합원에게 정보다.
 */
export function renderDigestMarkdown(
  items: GrantItem[],
  weekKeyValue: string,
  todayIso: string
): string {
  const active = activeItems(items)
  const head = `${weekKeyValue} 기준 경기·서울 음악 분야 지원사업입니다.\n`

  if (active.length === 0) {
    return `${head}\n이번 주에 새로 안내할 공고가 없습니다.\n`
  }

  const body = active
    .map(it => {
      const lines = [
        `### [${escapeMarkdown(it.title)}](${it.url})`,
        '',
        `- 마감: ${dDay(it.apply_end, todayIso)}${it.apply_end ? ` (${it.apply_end})` : ''}`,
        `- 분류: ${escapeMarkdown(tagLine(it))}`,
      ]
      if (it.summary) lines.push(`- ${escapeMarkdown(it.summary)}`)
      return lines.join('\n')
    })
    .join('\n\n')

  const foot =
    '\n\n---\n\n' +
    '공고 정보는 각 기관 원문을 기준으로 합니다. 신청 전 원문에서 자격과 마감을 다시 확인해 주세요.\n'

  return `${head}\n${body}${foot}`
}

/** 이메일 제목과 본문. */
export function renderDigestEmail(
  items: GrantItem[],
  weekKeyValue: string,
  todayIso: string,
  settingsUrl: string
): { subject: string; html: string } {
  const active = activeItems(items)
  const subject = `[경기아트콜렉티브] 이번 주 예술지원사업 ${active.length}건`
  const safeSettings = escapeHtml(settingsUrl)

  const cards = active
    .map(
      it => `
  <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px">
    <a href="${escapeHtml(it.url)}" style="font-size: 15px; font-weight: 700; color: #1f2937; text-decoration: none">${escapeHtml(it.title)}</a>
    <p style="font-size: 12px; color: #6b7280; margin: 8px 0 0">${escapeHtml(dDay(it.apply_end, todayIso))}${it.apply_end ? ` · 마감 ${escapeHtml(it.apply_end)}` : ''} · ${escapeHtml(tagLine(it))}</p>
    ${it.summary ? `<p style="font-size: 13px; line-height: 1.6; color: #4b5563; margin: 8px 0 0">${escapeHtml(it.summary.slice(0, 140))}</p>` : ''}
  </div>`
    )
    .join('')

  const empty =
    '<p style="font-size: 14px; color: #4b5563">이번 주에 새로 안내할 공고가 없습니다.</p>'

  const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
  <h1 style="font-size: 20px; font-weight: 700; margin-bottom: 8px">이번 주 예술지원사업</h1>
  <p style="font-size: 13px; color: #6b7280; margin: 0 0 20px">${escapeHtml(weekKeyValue)} · 경기·서울 음악 분야</p>
  ${active.length === 0 ? empty : cards}
  <p style="font-size: 12px; line-height: 1.6; color: #9ca3af; margin-top: 24px">
    공고 정보는 각 기관 원문을 기준으로 합니다. 신청 전 원문에서 자격과 마감을 다시 확인해 주세요.<br />
    이 메일을 받지 않으려면 <a href="${safeSettings}" style="color: #6b7280">마이페이지 &gt; 설정</a>에서 이메일 알림을 꺼 주세요.
  </p>
</div>`

  return { subject, html }
}

/** 인앱 알림 제목·본문. */
export function renderDigestNotification(
  items: GrantItem[],
  weekKeyValue: string
): { title: string; message: string } {
  const count = activeItems(items).length
  return {
    title: '이번 주 예술지원사업 안내',
    message:
      count === 0
        ? `${weekKeyValue} 지원사업 안내가 올라왔습니다.`
        : `경기·서울 음악 분야 지원사업 ${count}건이 올라왔습니다.`,
  }
}
