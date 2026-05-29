'use client'

import { useState, useEffect, useRef } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase/client'

type MessageType = 'error' | 'warning' | 'success' | 'loading'

const msgClassMap: Record<MessageType, string> = {
  warning: 'bg-amber-50 text-amber-800 border border-amber-200',
  success: 'bg-green-50 text-green-800 border border-green-200',
  loading: 'bg-blue-50 text-blue-800 border border-blue-200',
  error: 'bg-red-50 text-red-800 border border-red-200',
}

export default function ResetPasswordPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<MessageType>('error')
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (mounted) setHasSession(!!session)
      } catch (err) {
        console.error('getSession error:', err)
        if (mounted) setHasSession(false)
      } finally {
        if (mounted) setChecking(false)
      }
    }
    check()
    return () => {
      mounted = false
      if (redirectTimer.current) clearTimeout(redirectTimer.current)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')

    if (password.length < 6) {
      setMessage(t('resetPassword.msgTooShort'))
      setMessageType('error')
      return
    }
    if (password !== confirm) {
      setMessage(t('resetPassword.msgMismatch'))
      setMessageType('error')
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setMessage(t('resetPassword.msgError'))
        setMessageType('error')
        return
      }
      setMessage(t('resetPassword.msgSuccess'))
      setMessageType('success')
      setDone(true)
      redirectTimer.current = setTimeout(() => router.push('/board'), 1500)
    } catch (err) {
      console.error('updateUser error:', err)
      setMessage(t('resetPassword.msgError'))
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('resetPassword.checking')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-12">
          <h1 className="tw-heading-secondary mb-4">{t('resetPassword.heading')}</h1>
          {hasSession && (
            <p className="tw-text-body text-gray-600">{t('resetPassword.subtitle')}</p>
          )}
        </div>

        {!hasSession ? (
          <div className="bg-white shadow-xl rounded-2xl overflow-hidden p-8 text-center">
            <div className={`mb-6 p-4 rounded-xl ${msgClassMap.error}`}>
              <div className="text-sm leading-relaxed">{t('resetPassword.msgInvalidSession')}</div>
            </div>
            <Link href="/forgot-password" className="w-full inline-block tw-btn-primary">
              {t('resetPassword.requestAgain')}
            </Link>
          </div>
        ) : (
          <>
            {message && (
              <div className={`mb-8 p-4 sm:p-6 rounded-xl shadow-sm ${msgClassMap[messageType]}`}>
                <div className="text-sm leading-relaxed">{message}</div>
              </div>
            )}
            <div className="bg-white shadow-xl rounded-2xl overflow-hidden">
              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div>
                  <label
                    htmlFor="new-password"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    {t('resetPassword.passwordLabel')}
                  </label>
                  <input
                    id="new-password"
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:bg-gray-50"
                    placeholder={t('resetPassword.passwordPlaceholder')}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={loading || done}
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-password"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    {t('resetPassword.confirmLabel')}
                  </label>
                  <input
                    id="confirm-password"
                    name="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:bg-gray-50"
                    placeholder={t('resetPassword.confirmPlaceholder')}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    disabled={loading || done}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || done}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  {loading ? t('resetPassword.submittingButton') : t('resetPassword.submitButton')}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
