import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { TimebankAccess } from '@/lib/timebank/access'
import TermsAgreement from '@/components/timebank/TermsAgreement'

/**
 * 타임뱅크 화면의 "지금은 할 수 없음" 안내(스펙 §8). 장터의 `MarketGate`는 조합원
 * 자격 안내뿐이라 쓰지 않는다 — 여기는 상태마다 문구가 다르다.
 *
 * - `unapproved`: 승인·활성 조합원이 아니다(화면 판정 `resolveTimebankViewer`)
 * - `disabled`·`not_agreed`·`terms_outdated`·`frozen`·`inactive`: 쓰기 판정
 *   (`classifyTimebankAccess` write 모드)의 결과. 제목은 API 응답 문구와 같다
 * - `boardOff`: 게시판 새 글 스위치가 꺼졌다(글쓰기 화면만)
 *
 * 미동의·구판이면 `showAgreement`일 때 이용규칙 전문과 동의 단추를 함께 그리고,
 * 아니면 목록의 동의 자리(`/board/timebank#terms`)로 보내는 링크를 단다.
 */
export type TimebankGateState = Exclude<TimebankAccess, 'ok'> | 'unapproved' | 'boardOff'

const AGREEMENT_STATES: ReadonlyArray<TimebankGateState> = ['not_agreed', 'terms_outdated']

export default function TimebankGate({
  state,
  variant = 'page',
  termsVersion,
  agreedVersion = null,
  showAgreement = false,
  backHref = '/board',
}: {
  state: TimebankGateState
  /** `page`는 화면 전체를 차지하고, `banner`는 목록·상세 위에 얹힌다. */
  variant?: 'page' | 'banner'
  /** 동의 단추에 실을 현재 판. 미동의·구판일 때만 쓴다. */
  termsVersion?: string
  agreedVersion?: string | null
  showAgreement?: boolean
  /** `page`의 돌아가기 링크. */
  backHref?: '/board' | '/board/timebank'
}) {
  const t = useTranslations('timebank')
  const needsAgreement = AGREEMENT_STATES.includes(state) && Boolean(termsVersion)

  const box = (
    <div
      role="status"
      data-testid="timebank-gate"
      data-state={state}
      className={`rounded-lg border border-yellow-200 bg-yellow-50 ${variant === 'page' ? 'p-6' : 'p-4'}`}
    >
      {variant === 'page' ? (
        <h1 className="mb-4 text-2xl font-bold text-yellow-800">{t(`gate.${state}.title`)}</h1>
      ) : (
        <p className="mb-1 font-semibold text-yellow-800">{t(`gate.${state}.title`)}</p>
      )}
      <p className={`text-yellow-700 ${variant === 'page' ? 'mb-4' : 'text-sm'}`}>
        {t(`gate.${state}.body`)}
      </p>
      {needsAgreement && !showAgreement && (
        <Link
          href={{ pathname: '/board/timebank', hash: 'terms' }}
          className="mt-2 inline-block text-sm font-medium text-yellow-800 underline hover:no-underline"
        >
          {t('gate.agreeLink')}
        </Link>
      )}
      {variant === 'page' && (
        <Link
          href={backHref}
          className="inline-block rounded-lg bg-yellow-600 px-4 py-2 text-white transition-colors hover:bg-yellow-700"
        >
          {backHref === '/board' ? t('backToBoard') : t('gate.backToList')}
        </Link>
      )}
    </div>
  )

  const agreement =
    needsAgreement && showAgreement && termsVersion ? (
      <TermsAgreement termsVersion={termsVersion} agreedVersion={agreedVersion} />
    ) : null

  if (variant === 'banner') {
    return (
      <div className="mb-6 space-y-4">
        {box}
        {agreement}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          {box}
          {agreement}
        </div>
      </div>
    </div>
  )
}
