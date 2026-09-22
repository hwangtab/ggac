/** 임시 스텁. 3부 계획(알림·메일)에서 채운다 — 라우트 배선을 먼저 고정한다. */
export async function notifyPledgePaid(_pledge: Record<string, unknown>): Promise<void> {}

/** 임시 스텁. 캠페인이 심사에 제출됐을 때. */
export async function notifyCampaignSubmitted(_campaign: Record<string, unknown>): Promise<void> {}

/** 임시 스텁. 관리자가 캠페인을 승인·반려했을 때. */
export async function notifyCampaignReviewed(
  _campaign: Record<string, unknown>,
  _action: 'approve' | 'reject'
): Promise<void> {}

/** 임시 스텁. 캠페인이 마감됐을 때. */
export async function notifyCampaignClosed(_campaign: Record<string, unknown>): Promise<void> {}
