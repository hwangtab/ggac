'use client'

/**
 * 편집기의 기본 정보 탭. 제목·한 줄 소개·분류·목표 금액·시작일·마감일·표지
 * 이미지를 받는다.
 *
 * 값은 껍데기(`page.tsx`)가 소유한다 — 이 컴포넌트는 `values`를 그대로
 * 그리고 바뀔 때마다 `onChange(next)`로 통째로 올려보내는 제어 컴포넌트다.
 * 탭이 `hidden`으로만 감춰지고 언마운트되지 않으므로, 값을 여기서 들고
 * 있어도 탭을 옮겼다 돌아와도 사라지지 않는다 — 다만 "저장하지 않은 변경"
 * 판단은 껍데기가 세 탭 값을 한곳에서 비교해야 하므로 값 자체는 항상 위로
 * 올린다.
 *
 * 목표 금액처럼 "보낼 수 없는 값"을 알리는 문장은 껍데기가 저장을 누른
 * 시점에 판정해 `goalError`로 내려보낸다 — 이 탭은 받은 문장을 그 칸 옆에
 * 그리고 포커스를 옮길 뿐이다. 판정을 여기서도 하면 저장 버튼이 무엇을 보고
 * 움직이는지가 두 곳으로 갈린다.
 *
 * 표지 이미지 업로드는 이 탭이 직접 `POST /api/media/upload`를 호출한다.
 * 업로드 중 상태·업로드 실패 배너는 이 탭만의 일이라(다른 탭과 공유할
 * 이유가 없다) 로컬 state로 둔다 — 필드 값과 달리 저장 대상이 아니다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FiAlertCircle } from 'react-icons/fi'

const CATEGORIES = ['공연', '음반', '전시', '출판', '영상', '기타'] as const

/** 편집기가 다루는 기본 정보 필드. 날짜는 `<input type="date">` 규격(`YYYY-MM-DD`),
 * 그 밖은 서버가 주는 형태 그대로다. 값이 없으면 빈 문자열이다(제어
 * 컴포넌트가 undefined를 받으면 안 되므로). */
export interface BasicInfoValues {
  title: string
  summary: string
  category: string
  /** 콤마 섞인 표시 문자열. 저장 시점에 정수로 바꾼다(개설 화면과 같은 방식). */
  goal_amount: string
  start_at: string
  end_at: string
  cover_image: string
}

export interface BasicInfoTabProps {
  values: BasicInfoValues
  onChange: (values: BasicInfoValues) => void
  editScope: 'all' | 'contentOnly' | 'none'
  /** 목표 금액 칸에 붙일 문장. 껍데기가 저장을 누른 순간에만 세운다. */
  goalError?: string
}

export default function BasicInfoTab({
  values,
  onChange,
  editScope,
  goalError = '',
}: BasicInfoTabProps) {
  const t = useTranslations('funding')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const uploadErrorRef = useRef<HTMLDivElement | null>(null)
  const goalInputRef = useRef<HTMLInputElement | null>(null)

  // 문장이 뜨는 순간 고쳐야 할 칸으로 데려간다 — 다른 배너와 같은 규칙이다.
  useEffect(() => {
    if (goalError) {
      goalInputRef.current?.focus()
      goalInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [goalError])

  useEffect(() => {
    if (uploadError) {
      uploadErrorRef.current?.focus()
      uploadErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [uploadError])

  const set = useCallback(
    <K extends keyof BasicInfoValues>(key: K, value: BasicInfoValues[K]) => {
      onChange({ ...values, [key]: value })
    },
    [values, onChange]
  )

  const handleGoalChange = useCallback(
    (raw: string) => {
      const digits = raw.replace(/[^0-9]/g, '')
      // 입력 중엔 숫자를 깎지 않는다 — 개설 화면(new/page.tsx)과 같은 규칙.
      set('goal_amount', digits === '' ? '' : Number(digits).toLocaleString('ko-KR'))
    },
    [set]
  )

  const handleCoverUpload = useCallback(
    async (file: File) => {
      setUploadError('')
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('bucket', 'attachments')
        const res = await fetch('/api/media/upload', { method: 'POST', body: formData })
        const body = await res.json().catch(() => null)
        if (res.ok === false || !body?.data?.public_url) {
          setUploadError(body?.error || t('creator.errorUpload'))
          return
        }
        set('cover_image', body.data.public_url as string)
      } catch {
        setUploadError(t('creator.errorUpload'))
      } finally {
        setUploading(false)
      }
    },
    [set, t]
  )

  const lockedInAll = editScope === 'none'
  // contentOnly: 제목·목표 금액·분류는 잠긴다 — 서버(`CONTENT_ONLY_FIELDS`)가
  // 이 셋을 애초에 받지 않는다. start_at도 그 목록에 없어 함께 잠근다(안
  // 잠그면 안 바꿔도 PATCH 본문에 실려 나가 저장 전체가 거절된다).
  const lockedWhenLive = editScope === 'contentOnly' || lockedInAll
  const disabledAll = lockedInAll

  return (
    <div className="space-y-5">
      {editScope === 'contentOnly' ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {t('creator.contentOnlyNotice')}
        </p>
      ) : null}

      <div>
        <label htmlFor="basic-title" className="mb-2 block text-sm font-medium text-gray-900">
          {t('creator.title')}
        </label>
        <input
          id="basic-title"
          value={values.title}
          onChange={e => set('title', e.target.value)}
          disabled={disabledAll || lockedWhenLive}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
        />
      </div>

      <div>
        <label htmlFor="basic-summary" className="mb-2 block text-sm font-medium text-gray-900">
          {t('creator.summary')}
        </label>
        <input
          id="basic-summary"
          value={values.summary}
          onChange={e => set('summary', e.target.value.slice(0, 200))}
          maxLength={200}
          disabled={disabledAll}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
        />
        <p className="mt-1 text-xs text-gray-500">{t('creator.summaryHelp')}</p>
      </div>

      <div>
        <label htmlFor="basic-goal" className="mb-2 block text-sm font-medium text-gray-900">
          {t('creator.goal')}
        </label>
        <input
          id="basic-goal"
          ref={goalInputRef}
          value={values.goal_amount}
          onChange={e => handleGoalChange(e.target.value)}
          inputMode="numeric"
          disabled={disabledAll || lockedWhenLive}
          aria-invalid={goalError ? true : undefined}
          aria-describedby={goalError ? 'basic-goal-error' : undefined}
          className={`w-full rounded-lg border px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500 ${
            goalError ? 'border-red-300' : 'border-gray-300'
          }`}
        />
        {goalError ? (
          <p
            id="basic-goal-error"
            role="alert"
            aria-live="assertive"
            className="mt-1 flex items-start gap-2 text-sm text-red-700"
          >
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
            <span>{goalError}</span>
          </p>
        ) : null}
        <p className="mt-1 text-xs text-gray-500">{t('creator.goalHelp')}</p>
      </div>

      <div>
        <label htmlFor="basic-category" className="mb-2 block text-sm font-medium text-gray-900">
          {t('creator.category')}
        </label>
        <select
          id="basic-category"
          value={values.category}
          onChange={e => set('category', e.target.value)}
          disabled={disabledAll || lockedWhenLive}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="basic-start" className="mb-2 block text-sm font-medium text-gray-900">
            {t('creator.startAt')}
          </label>
          <input
            id="basic-start"
            type="date"
            value={values.start_at}
            onChange={e => set('start_at', e.target.value)}
            disabled={disabledAll || lockedWhenLive}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>
        <div>
          <label htmlFor="basic-end" className="mb-2 block text-sm font-medium text-gray-900">
            {t('creator.endAt')}
          </label>
          <input
            id="basic-end"
            type="date"
            value={values.end_at}
            onChange={e => set('end_at', e.target.value)}
            disabled={disabledAll}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>
      </div>
      <p className="-mt-3 text-xs text-gray-500">{t('creator.endAtNote')}</p>

      <div>
        <span className="mb-2 block text-sm font-medium text-gray-900">
          {t('creator.coverImage')}
        </span>
        {values.cover_image ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob 공개 URL/사이트 상대 경로를 그대로 미리보기하므로 next/image 최적화 대상이 아니다.
          <img
            src={values.cover_image}
            alt={t('creator.coverImageAlt')}
            className="mb-3 h-40 w-full rounded-lg border border-gray-200 object-cover"
          />
        ) : null}

        {uploadError ? (
          <div
            ref={uploadErrorRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 outline-none"
          >
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
            <span>{uploadError}</span>
          </div>
        ) : null}

        <label className="inline-block">
          <span className="sr-only">{t('creator.coverImageUpload')}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            disabled={disabledAll || uploading}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void handleCoverUpload(file)
            }}
            className="block text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white file:disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>
        {uploading ? (
          <p className="mt-2 text-sm text-gray-600">{t('creator.coverImageUploading')}</p>
        ) : null}
      </div>
    </div>
  )
}
