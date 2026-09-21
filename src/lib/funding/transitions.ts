/**
 * 캠페인 상태 전이의 **정본**. 라우트는 이 표를 물어보고만 움직인다.
 *
 * 전진만 허용한다. 유일한 역행은 심사 중(`submitted`)에서 초안으로 돌아가는
 * 반려·철회다. `active`는 되돌리지 않는다 — 공개된 캠페인을 없던 일로 하려면
 * 마감(`close`)한다.
 */

export type CampaignStatus = 'draft' | 'submitted' | 'active' | 'closed' | 'settled'
export type CampaignAction = 'submit' | 'withdraw' | 'approve' | 'reject' | 'close' | 'settle'

const TABLE: Record<CampaignStatus, Partial<Record<CampaignAction, CampaignStatus>>> = {
  draft: { submit: 'submitted' },
  submitted: { approve: 'active', reject: 'draft', withdraw: 'draft' },
  active: { close: 'closed' },
  closed: { settle: 'settled' },
  settled: {},
}

export function nextStatus(from: CampaignStatus, action: CampaignAction): CampaignStatus | null {
  return TABLE[from]?.[action] ?? null
}

/** 심사와 정산은 관리자만. 나머지는 개설자도 된다. */
export function actorFor(action: CampaignAction): 'owner_or_admin' | 'admin' {
  return action === 'approve' || action === 'reject' || action === 'settle'
    ? 'admin'
    : 'owner_or_admin'
}

/** active에서 바꿔도 되는 컬럼(snake_case, 라우트 입력 키). 제목·slug·목표액·수수료율은 잠긴다. */
export const CONTENT_ONLY_FIELDS = ['summary', 'story', 'cover_image', 'og_image', 'end_at'] as const

export function editScope(status: CampaignStatus): 'all' | 'contentOnly' | 'none' {
  if (status === 'draft') return 'all'
  if (status === 'active') return 'contentOnly'
  return 'none'
}

export const PUBLIC_CAMPAIGN_STATUSES = ['active', 'closed', 'settled'] as const

export function isCampaignAction(value: unknown): value is CampaignAction {
  return (
    typeof value === 'string' &&
    ['submit', 'withdraw', 'approve', 'reject', 'close', 'settle'].includes(value)
  )
}
