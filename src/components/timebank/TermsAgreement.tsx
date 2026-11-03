'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { getTimebankTerms } from '@/constants/timebankTerms'
import { parseTermsText } from '@/components/timebank/termsFormat'

/**
 * 이용규칙 전문(판 표시)과 동의 단추. 동의는 `POST /api/timebank/agree`
 * (`{ terms_version }` — 서버가 현재 판과 같은지 다시 본다)이고, 성공하면 화면을
 * 새로 읽어 게이트를 걷는다.
 *
 * 본문은 `TIMEBANK_TERMS`(한국어 원문이 정본)를 `parseTermsText`로 쪼개 텍스트
 * 노드로만 그린다 — HTML을 해석하지 않는다.
 */
export default function TermsAgreement({
  termsVersion,
  agreedVersion = null,
}: {
  /** 현재 판(`timebank_features.terms_version`). */
  termsVersion: string
  /** 전에 동의한 판. 현재 판과 다르면 "다시 동의" 안내를 붙인다. */
  agreedVersion?: string | null
}) {
  const t = useTranslations('timebank.terms')
  const locale = useLocale()
  const router = useRouter()
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const source = getTimebankTerms(termsVersion)
  const blocks = source ? parseTermsText(source) : []

  const agree = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/timebank/agree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms_version: termsVersion }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('error'))
        return
      }
      router.refresh()
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id="terms"
      aria-labelledby="timebank-terms-heading"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="timebank-terms-heading" className="text-lg font-semibold text-gray-900">
          {t('heading')}
        </h2>
        <span className="text-sm text-gray-500">{t('version', { version: termsVersion })}</span>
      </div>

      {locale !== 'ko' && <p className="mb-3 text-sm text-gray-600">{t('originalNotice')}</p>}
      {agreedVersion && agreedVersion !== termsVersion && (
        <p className="mb-3 text-sm text-amber-800">
          {t('previouslyAgreed', { version: agreedVersion })}
        </p>
      )}

      {source === null ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {t('missing')}
        </p>
      ) : (
        <>
          <div
            lang="ko"
            className="max-h-96 space-y-3 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-700"
          >
            {blocks.map((block, blockIndex) => (
              <div key={blockIndex}>
                {block.map((line, lineIndex) => (
                  <p key={lineIndex} className={line.indent ? 'pl-4' : undefined}>
                    {line.segments.map((segment, segmentIndex) =>
                      segment.bold ? (
                        <strong key={segmentIndex} className="font-semibold text-gray-900">
                          {segment.text}
                        </strong>
                      ) : (
                        <span key={segmentIndex}>{segment.text}</span>
                      )
                    )}
                  </p>
                ))}
              </div>
            ))}
          </div>

          <label className="mt-4 flex items-start gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span>{t('checkbox')}</span>
          </label>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void agree()}
              disabled={!checked || busy}
              className="rounded-lg bg-primary-600 px-6 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {busy ? t('agreeing') : t('agree')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
