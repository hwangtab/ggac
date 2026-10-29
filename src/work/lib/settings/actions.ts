'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { updateProfile } from '@/db/queries/profiles'
import { refreshShell } from '@work/lib/channels/action-support'
import { staffProfileSchema, type ProfileFormState } from '@work/lib/auth/profile-schema'

/**
 * 표시 이름·직함 수정 — 원본 kosmart-work `app/(app)/settings/actions.ts`의 `updateStaffProfile`
 * (같은 이름·`useActionState` 시그니처·반환 모양). **위치를 옮겼다:** `src/work/lib/settings/actions.ts`.
 *
 * ggac에는 업무툴 전용 구성원 표가 없어서(설계 §3) 표시 이름은 ggac 회원 프로필(`member_profiles.display_name`)이다 —
 * 마이페이지에서 바꾸는 것과 같은 값이고, 본인 행만 바꾼다. **직함(`director_title`)은 관리자가 정한다**
 * (`/api/admin/members/flags`). 그래서 직함이 지금 값과 다르면 저장하지 않고 그 칸에 안내를 돌려준다.
 */
export async function updateStaffProfile(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const { user, staff } = await requireWorkStaff()
  const parsed = staffProfileSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    title: formData.get('title') ?? '',
  })
  if (!parsed.success) {
    const fieldErrors: Partial<Record<'displayName' | 'title', string>> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if ((key === 'displayName' || key === 'title') && !fieldErrors[key]) {
        fieldErrors[key] = issue.message
      }
    }
    return { status: 'error', message: '입력값을 확인해 주세요.', fieldErrors }
  }
  if ((parsed.data.title ?? null) !== (staff.title ?? null)) {
    return {
      status: 'error',
      message: '입력값을 확인해 주세요.',
      fieldErrors: { title: '직함은 관리자가 정합니다. 바꾸려면 사무국에 요청해 주세요.' },
    }
  }

  try {
    await updateProfile(user.id, { display_name: parsed.data.displayName })
  } catch (error) {
    console.error('[updateStaffProfile] 프로필 갱신 실패:', error)
    return { status: 'error', message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  refreshShell()
  return { status: 'success', message: '저장했습니다.' }
}
