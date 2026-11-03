import { resolveMarketViewer } from '@/lib/server/marketPage'
import { loadParty } from '@/db/queries/timebankLedger'
import { getTimebankProfile } from '@/db/queries/timebankProfiles'
import { classifyTimebankAccess, type TimebankAccess } from '@/lib/timebank/access'
import { TIMEBANK_DEFAULTS, getTimebankSettings } from '@/lib/timebank/settings'
import type { Locale } from '@/i18n/routing'
import { createLogger } from '@/utils/logger'

const log = createLogger('timebankPage')

export type TimebankViewer =
  | {
      kind: 'member'
      userId: string
      isAdmin: boolean
      /**
       * 쓰기 판정(`classifyTimebankAccess` write 모드) — `requireTimebankParticipant`와
       * 같은 표다. `'ok'`가 아니면 화면은 쓰기 단추를 숨기고 `TimebankGate`로 이유를 보인다.
       */
      access: TimebankAccess
      enabled: boolean
      coopTasksEnabled: boolean
      termsVersion: string
      /** 어느 판이든 동의한 적이 있으면 그 판·일자. */
      agreedVersion: string | null
      agreedAt: string | null
    }
  /** 로그인은 했지만 승인·활성 조합원이 아니다(승인 대기 등). */
  | { kind: 'not-member' }

/**
 * 타임뱅크 화면(`/board/timebank/*`) 진입 판정. 비로그인·미승인 판정은 장터의
 * `resolveMarketViewer`를 그대로 쓴다(비로그인은 여기서 `/login?redirect=`로 보낸다).
 * 그 위에 스위치·동의·탈퇴 신청 상태를 얹는다.
 *
 * 이 판정은 **안내**다. 읽기는 승인 조합원이면 연다(API `requireTimebankReader`와
 * 같다). 쓰기의 경계는 `/api/timebank/*`의 `requireTimebankParticipant`가 따로 지킨다.
 * 설정이나 참여 상태를 못 읽으면 꺼짐·미동의로 본다(fail-closed — 쓰기 단추가 숨는다).
 */
export async function resolveTimebankViewer(
  locale: Locale,
  returnTo: string
): Promise<TimebankViewer> {
  const viewer = await resolveMarketViewer(locale, returnTo)
  if (viewer.kind !== 'member') return { kind: 'not-member' }

  let settings = { ...TIMEBANK_DEFAULTS }
  try {
    settings = await getTimebankSettings()
  } catch (error) {
    log.error('타임뱅크 설정 조회 실패 — 꺼짐으로 처리', {
      error: (error as Error)?.message,
    })
  }

  let party = null
  let profile = null
  try {
    ;[party, profile] = await Promise.all([
      loadParty(viewer.userId, settings.terms_version),
      getTimebankProfile(viewer.userId),
    ])
  } catch (error) {
    log.error('타임뱅크 참여 상태 조회 실패 — 미동의로 처리', {
      error: (error as Error)?.message,
    })
  }

  const agreed = profile?.agreed_at != null
  return {
    kind: 'member',
    userId: viewer.userId,
    isAdmin: viewer.isAdmin,
    access: classifyTimebankAccess({ settings, party, agreed, mode: 'write' }),
    enabled: settings.enabled === true,
    coopTasksEnabled: settings.coop_tasks_enabled === true,
    termsVersion: settings.terms_version,
    agreedVersion: agreed ? (profile?.terms_version ?? null) : null,
    agreedAt: agreed ? (profile?.agreed_at ?? null) : null,
  }
}
