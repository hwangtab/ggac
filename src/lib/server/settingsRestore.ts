/**
 * 설정 백업 복원(`POST /api/admin/settings/backup`)이 **건너뛰는** 설정.
 *
 * 복원은 업로드한 파일의 모든 `setting_key`를 `updateSystemSetting`으로 쓴다.
 * 그런데 `timebank_features`의 수치와 스위치는 이사회가 의결한 이용규칙의
 * 내용이라(스펙 §9.2) 의결 근거를 받는 전용 라우트(`PUT /api/admin/timebank/settings`)
 * 로만 바뀌어야 한다. 타임뱅크를 켠 백업 파일 하나로 그 원칙을 우회하지 못하게
 * 여기서 걸러 내고, 건너뛴 키는 응답에 그대로 보고한다(조용히 버리지 않는다).
 *
 * 카테고리가 아니라 **키**로 가린다 — 백업 파일의 `category`를 바꿔 끼워도
 * 막힌다. 순수 함수라 `node --test`가 직접 부른다(아무것도 import하지 않는다).
 */
export const GOVERNED_SETTING_KEYS: readonly string[] = Object.freeze(['timebank_features'])

export function partitionRestorableSettings<T extends { category: string; setting_key: string }>(
  settings: readonly T[]
): { restorable: T[]; skipped: string[] } {
  const restorable: T[] = []
  const skipped: string[] = []
  for (const setting of settings) {
    if (GOVERNED_SETTING_KEYS.includes(setting.setting_key)) {
      skipped.push(`${setting.category}.${setting.setting_key}`)
    } else {
      restorable.push(setting)
    }
  }
  return { restorable, skipped }
}
