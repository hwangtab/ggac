'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth/client'

type MessageType = 'error' | 'warning' | 'success' | 'loading'

const msgClassMap: Record<MessageType, string> = {
  warning: 'bg-amber-50 text-amber-800 border border-amber-200',
  success: 'bg-green-50 text-green-800 border border-green-200',
  loading: 'bg-blue-50 text-blue-800 border border-blue-200',
  error: 'bg-red-50 text-red-800 border border-red-200',
}

export default function ForgotPasswordPage() {
  const t = useTranslations('auth')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<MessageType>('error')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const { error } = await authClient.requestPasswordReset({ email })

      if (error && error.status === 429) {
        setMessage(t('forgotPassword.msgRateLimited'))
        setMessageType('warning')
        return
      }
      // 이메일 존재 여부를 노출하지 않기 위해 성공/실패 모두 동일 안내
      // (Better Auth의 request-password-reset도 같은 이유로 사용자 존재 여부와
      // 무관하게 항상 성공을 반환한다 — password.mjs 실측)
      setMessage(t('forgotPassword.msgSent'))
      setMessageType('success')
      // 성공 안내 후 재제출을 막아 이메일 발송 남용을 방지
      setSubmitted(true)
    } catch (err) {
      console.error('requestPasswordReset error:', err)
      setMessage(t('forgotPassword.msgError'))
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-32 md:pt-40 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-12">
          <h1 className="tw-heading-secondary mb-4">{t('forgotPassword.heading')}</h1>
          <p className="tw-text-body text-gray-600">{t('forgotPassword.subtitle')}</p>
        </div>

        {message && (
          <div className={`mb-8 p-4 sm:p-6 rounded-xl shadow-sm ${msgClassMap[messageType]}`}>
            <div className="text-sm leading-relaxed">{message}</div>
          </div>
        )}

        <div className="bg-white shadow-xl rounded-2xl overflow-hidden">
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div>
              <label
                htmlFor="email-address"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                {t('forgotPassword.emailLabel')}
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:bg-gray-50 disabled:text-gray-500"
                placeholder={t('forgotPassword.emailPlaceholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading || submitted}
              />
            </div>
            <button
              type="submit"
              disabled={loading || submitted}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              {loading ? t('forgotPassword.submittingButton') : t('forgotPassword.submitButton')}
            </button>
          </form>
        </div>

        <div className="text-center mt-8">
          <Link
            href="/login"
            className="font-medium text-primary-600 hover:text-primary-500 transition-colors"
          >
            {t('forgotPassword.backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
