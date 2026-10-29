import { z } from 'zod'

/**
 * 표시 이름·직함 한도 — 설정·초대 수락 가입·관리자 편집이 모두 이 스키마를 쓴다(QA #26).
 * DB 도 같은 한도다: 0001 CHECK + 0013 trg_05_normalize_profile(앞뒤 공백을 잘라 저장하고 50자를 넘으면 거부).
 */
export const DISPLAY_NAME_MAX = 50
export const TITLE_MAX = 50

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, '표시 이름을 입력해 주세요.')
  .max(DISPLAY_NAME_MAX, `표시 이름은 ${DISPLAY_NAME_MAX}자까지 쓸 수 있습니다.`)

export const titleSchema = z
  .string()
  .trim()
  .max(TITLE_MAX, `직함은 ${TITLE_MAX}자까지 쓸 수 있습니다.`)
  .transform(v => (v === '' ? null : v))

/** 설정 화면 — 표시 이름·직함(work.staff). DB CHECK 와 같은 한도. */
export const staffProfileSchema = z.object({
  displayName: displayNameSchema,
  title: titleSchema,
})

export type StaffProfileInput = z.input<typeof staffProfileSchema>

export type ProfileFormState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | {
      status: 'error'
      message: string
      fieldErrors?: Partial<Record<'displayName' | 'title', string>>
    }
