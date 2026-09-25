/**
 * 선점 만료까지 남은 시간을 안내 문구용 분 단위로 계산한다. 네트워크·DB를
 * 모른다 — `PledgeForm`이 서버가 돌려준 `holdExpiresAt`(ISO 문자열)로 한 번
 * 계산해 굳혀 쓴다. 실시간으로 째깍이는 카운트다운이 아니다.
 */

/**
 * 만료 시각까지 남은 분을 올림한다. 이미 지났거나 시각을 못 읽으면 0.
 *
 * 올림(ceil)을 쓰는 이유: 9분 30초가 남았을 때 "9분"이라고 하면 실제보다
 * 촉박해 보인다. 초 단위 정밀도가 필요한 자리가 아니라 한 번 계산해 굳히는
 * 안내 문구이므로, 남은 시간을 깎지 않는 올림 하나로 충분하다.
 */
export function minutesUntil(targetIso: string, now: Date = new Date()): number {
  const target = new Date(targetIso).getTime()
  if (!Number.isFinite(target)) return 0
  const diffMs = target - now.getTime()
  if (diffMs <= 0) return 0
  return Math.ceil(diffMs / 60_000)
}
