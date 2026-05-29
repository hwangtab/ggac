/** 재적 이사 N명에 대해 정족수(절반 이상) 필요 인원 = ceil(N/2) */
export function requiredQuorum(totalDirectors: number): number {
  if (totalDirectors <= 0) return 0
  return Math.ceil(totalDirectors / 2)
}

/** 출석 인원이 정족수를 충족하는지 */
export function isQuorumMet(totalDirectors: number, attendedCount: number): boolean {
  return totalDirectors > 0 && attendedCount >= requiredQuorum(totalDirectors)
}
