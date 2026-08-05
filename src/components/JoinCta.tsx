'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'

type State = 'unknown' | 'guest' | 'approved' | 'pending' | 'rejected'

/**
 * 조합원 가입 CTA.
 *
 * 미들웨어는 이미 승인된 조합원이 /signup에 오면 /board로 되돌린다(정상 동작).
 * 그런데 /connect는 로그인 여부와 무관하게 "동료 되기 (조합원 가입하기)"를
 * 그대로 보여 줬다. 이미 조합원인 사람이 누르면 아무 설명 없이 게시판으로
 * 튕기는 것처럼 보인다.
 *
 * /connect는 ISR(24시간 캐시) 서버 컴포넌트라 페이지에서 세션을 읽을 수 없다.
 * 이 조각만 클라이언트에서 상태를 확인해 링크를 바꾼다. 확인 전에는 가입
 * 링크를 그대로 두어 비로그인 방문자(대다수)가 기다리지 않게 한다.
 */
export default function JoinCta() {
  const t = useTranslations('connect')
  const [state, setState] = useState<State>('unknown')

  useEffect(() => {
    let alive = true
    fetch('/api/auth/verify-session')
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (!alive) return
        const data = json?.data
        if (!data?.authenticated) return setState('guest')
        const profile = data.profile
        if (!profile) return setState('guest')
        if (profile.registration_status === 'approved' && profile.is_active) {
          return setState('approved')
        }
        if (profile.registration_status === 'pending') return setState('pending')
        if (profile.registration_status === 'rejected') return setState('rejected')
        setState('guest')
      })
      .catch(() => {
        if (alive) setState('guest')
      })
    return () => {
      alive = false
    }
  }, [])

  const primary =
    'inline-flex min-h-[48px] w-full items-center justify-center bg-white px-8 text-sm font-semibold tracking-tight text-black transition-colors duration-200 hover:bg-white/85 sm:w-auto'
  const ghost =
    'inline-flex min-h-[48px] w-full items-center justify-center border border-white/50 px-8 text-sm font-semibold tracking-tight text-white transition-colors duration-200 hover:border-white hover:bg-white/10 sm:w-auto'

  if (state === 'approved') {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-[15px] text-white/70">{t('alreadyMember')}</p>
        <Link href="/board" className={ghost}>
          {t('alreadyMemberCta')}
        </Link>
      </div>
    )
  }

  if (state === 'pending') {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-[15px] text-white/70">{t('applicationPending')}</p>
        <Link href="/register/pending" className={ghost}>
          {t('applicationPendingCta')}
        </Link>
      </div>
    )
  }

  if (state === 'rejected') {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-[15px] text-white/70">{t('applicationRejected')}</p>
        <Link href="/register/rejected" className={ghost}>
          {t('applicationRejectedCta')}
        </Link>
      </div>
    )
  }

  return (
    <Link href="/signup" data-poster-keep className={primary}>
      {t('joinCta')}
    </Link>
  )
}
