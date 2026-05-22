'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import toast from 'react-hot-toast'
import FormField from '@/components/FormField'
import { Link } from '@/i18n/navigation'

interface Props {
  eventSlug: string
}

interface FormState {
  applicant_name: string
  contact_email: string
  contact_phone: string
  performance_info: string
  items_to_sell: string
  links: string
  message: string
}

const initialForm: FormState = {
  applicant_name: '',
  contact_email: '',
  contact_phone: '',
  performance_info: '',
  items_to_sell: '',
  links: '',
  message: '',
}

const PARTICIPATION_OPTIONS = ['booth', 'performance'] as const
type ParticipationOption = (typeof PARTICIPATION_OPTIONS)[number]

export default function EventApplicationForm({ eventSlug }: Props) {
  const t = useTranslations('application')

  const [form, setForm] = useState<FormState>(initialForm)
  const [participation, setParticipation] = useState<ParticipationOption[]>([])
  const [photoUrl, setPhotoUrl] = useState<string>('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState | 'privacy' | 'participation' | 'photo', string>>
  >({})
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (errors[name as keyof FormState]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setPhotoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(
        `/api/event-applications/photo?event_slug=${encodeURIComponent(eventSlug)}`,
        { method: 'POST', body: fd }
      )
      if (!res.ok) {
        toast.error(t('photoError'))
        return
      }
      const json = await res.json()
      setPhotoUrl(json.data?.url ?? '')
      if (json.data?.url && errors.photo) {
        setErrors(prev => ({ ...prev, photo: undefined }))
      }
    } catch {
      toast.error(t('photoError'))
    } finally {
      setPhotoUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const validate = (): boolean => {
    const newErrors: typeof errors = {}

    if (!form.applicant_name.trim()) newErrors.applicant_name = t('errorRequired')
    if (
      form.contact_email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())
    ) {
      newErrors.contact_email = t('errorEmailInvalid')
    }
    if (!form.contact_phone.trim()) newErrors.contact_phone = t('errorRequired')
    if (!form.performance_info.trim()) newErrors.performance_info = t('errorRequired')
    if (!form.items_to_sell.trim()) newErrors.items_to_sell = t('errorRequired')
    if (!photoUrl) newErrors.photo = t('errorRequired')
    if (participation.length === 0) newErrors.participation = t('errorParticipation')
    if (!privacyConsent) newErrors.privacy = t('errorPrivacy')

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      const res = await fetch('/api/event-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_slug: eventSlug,
          applicant_name: form.applicant_name.trim(),
          contact_email: form.contact_email.trim() || undefined,
          contact_phone: form.contact_phone.trim(),
          performance_info: form.performance_info.trim(),
          items_to_sell: form.items_to_sell.trim(),
          links: form.links.trim() || undefined,
          message: form.message.trim() || undefined,
          participation_type: participation.join(','),
          photo_url: photoUrl,
          privacy_consent: privacyConsent,
        }),
      })

      if (res.status === 429) {
        toast.error(t('toastTooMany'))
        return
      }

      if (!res.ok) {
        toast.error(t('toastError'))
        return
      }

      toast.success(t('toastSuccess'))
      setSubmitted(true)
    } catch {
      toast.error(t('toastError'))
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
        <div className="mb-3 text-3xl">✅</div>
        <h4 className="text-lg font-semibold text-green-800">{t('successTitle')}</h4>
        <p className="mt-2 text-sm text-green-700">{t('successMessage')}</p>
      </div>
    )
  }

  const textareaClass =
    'w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all duration-200 resize-none'

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <FormField
        label={t('nameLabel')}
        name="applicant_name"
        value={form.applicant_name}
        onChange={handleChange}
        placeholder={t('namePlaceholder')}
        required
        error={errors.applicant_name}
        state={errors.applicant_name ? 'error' : 'default'}
      />

      <FormField
        label={t('emailLabel')}
        name="contact_email"
        type="email"
        value={form.contact_email}
        onChange={handleChange}
        placeholder={t('emailPlaceholder')}
        error={errors.contact_email}
        state={errors.contact_email ? 'error' : 'default'}
      />

      <FormField
        label={t('phoneLabel')}
        name="contact_phone"
        type="tel"
        value={form.contact_phone}
        onChange={handleChange}
        placeholder={t('phonePlaceholder')}
        required
        error={errors.contact_phone}
        state={errors.contact_phone ? 'error' : 'default'}
      />

      {/* 공연 소개 */}
      <div className="space-y-2">
        <label htmlFor="performance_info" className="block text-sm font-medium text-gray-700">
          {t('performanceLabel')} <span className="text-red-500">*</span>
        </label>
        <textarea
          id="performance_info"
          name="performance_info"
          value={form.performance_info}
          onChange={handleChange}
          placeholder={t('performancePlaceholder')}
          rows={3}
          className={`${textareaClass} ${errors.performance_info ? 'border-red-500 bg-red-50 focus:ring-red-500' : ''}`}
        />
        {errors.performance_info && (
          <p className="text-sm text-red-600">{errors.performance_info}</p>
        )}
      </div>

      {/* 판매 물건 */}
      <div className="space-y-2">
        <label htmlFor="items_to_sell" className="block text-sm font-medium text-gray-700">
          {t('itemsLabel')} <span className="text-red-500">*</span>
        </label>
        <textarea
          id="items_to_sell"
          name="items_to_sell"
          value={form.items_to_sell}
          onChange={handleChange}
          placeholder={t('itemsPlaceholder')}
          rows={3}
          className={`${textareaClass} ${errors.items_to_sell ? 'border-red-500 bg-red-50 focus:ring-red-500' : ''}`}
        />
        {errors.items_to_sell && <p className="text-sm text-red-600">{errors.items_to_sell}</p>}
      </div>

      {/* 상품 사진 */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">
          {t('photoLabel')} <span className="text-red-500">*</span>
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={photoUploading}
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {photoUploading ? t('photoUploading') : t('photoButton')}
          </button>
          {photoUrl && (
            <button
              type="button"
              onClick={() => setPhotoUrl('')}
              className="text-sm text-red-600 hover:text-red-700 underline underline-offset-2"
            >
              {t('photoRemove')}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {photoUrl && (
          <img
            src={photoUrl}
            alt="상품 미리보기"
            className="mt-2 h-40 w-auto rounded-lg object-cover border border-gray-200"
          />
        )}
        {errors.photo && <p className="text-sm text-red-600">{errors.photo}</p>}
      </div>

      <FormField
        label={t('linksLabel')}
        name="links"
        value={form.links}
        onChange={handleChange}
        placeholder={t('linksPlaceholder')}
      />

      {/* 기타 요청사항 */}
      <div className="space-y-2">
        <label htmlFor="message" className="block text-sm font-medium text-gray-700">
          {t('messageLabel')}
        </label>
        <textarea
          id="message"
          name="message"
          value={form.message}
          onChange={handleChange}
          placeholder={t('messagePlaceholder')}
          rows={3}
          className={textareaClass}
        />
      </div>

      {/* 참여 분야 */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">
          {t('participationLabel')} <span className="text-red-500">*</span>
        </p>
        <div className="space-y-2">
          {PARTICIPATION_OPTIONS.map(opt => (
            <label key={opt} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={participation.includes(opt)}
                onChange={e => {
                  setParticipation(prev =>
                    e.target.checked ? [...prev, opt] : prev.filter(v => v !== opt)
                  )
                  if (e.target.checked && errors.participation) {
                    setErrors(prev => ({ ...prev, participation: undefined }))
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">
                {opt === 'booth' ? t('participationBooth') : t('participationPerformance')}
              </span>
            </label>
          ))}
        </div>
        {errors.participation && <p className="text-sm text-red-600">{errors.participation}</p>}
      </div>

      {/* 개인정보 수집·이용 고지 및 동의 */}
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 space-y-1.5">
          <p className="font-semibold text-gray-900">{t('privacyNoticeTitle')}</p>
          <p>{t('privacyNoticeItems')}</p>
          <p>{t('privacyNoticePurpose')}</p>
          <p>{t('privacyNoticeRetention')}</p>
          <p className="text-gray-500">{t('privacyNoticeRights')}</p>
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1 text-primary-600 hover:text-primary-700 underline underline-offset-4 text-xs"
          >
            {t('privacyPolicyLink')} →
          </Link>
        </div>
        <div className="space-y-1">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={privacyConsent}
              onChange={e => {
                setPrivacyConsent(e.target.checked)
                if (e.target.checked && errors.privacy) {
                  setErrors(prev => ({ ...prev, privacy: undefined }))
                }
              }}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">{t('privacyConsent')}</span>
          </label>
          {errors.privacy && <p className="text-sm text-red-600 pl-7">{errors.privacy}</p>}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full md:w-auto px-8 py-4 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors duration-200 text-center shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {t('submittingButton')}
          </span>
        ) : (
          t('submitButton')
        )}
      </button>
    </form>
  )
}
