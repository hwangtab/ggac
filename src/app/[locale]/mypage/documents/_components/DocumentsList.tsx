'use client'

import { useRef, useState } from 'react'
import { FiDownload, FiFilePlus, FiUpload, FiAlertTriangle, FiFileText } from 'react-icons/fi'
import { Link, useRouter } from '@/i18n/navigation'
import {
  createMemberDocument,
  documentTypeLabel,
  formatDocumentBytes,
  formatDocumentDate,
  memberDocumentFileUrl,
  uploadMemberDocumentFile,
} from '@/lib/memberDocuments/client'
import {
  MEMBER_DOCUMENT_EXTENSIONS,
  MEMBER_DOCUMENT_MAX_FILE_BYTES,
  quotaRatio,
  type MemberNewDocumentType,
} from '@/lib/memberDocuments/rules'
import { useDesktopEditor } from '@work/components/files/office-edit/use-desktop-editor'

export type DocumentListItem = {
  id: string
  name: string
  latestVersionNo: number
  latestVersionId: string
  size: number
  totalSize: number
  versionCount: number
  updatedAt: string
  deletionNotifiedAt: string | null
}

export type DocumentUsage = { stored: number; pending: number; total: number; quota: number }

const ACCEPT = MEMBER_DOCUMENT_EXTENSIONS.map(e => `.${e}`).join(',')

/**
 * 내 문서함 목록(docs/board-work/04-조합원-문서함.md §8) — 사용량 막대·올리기·새 문서·문서 표. 올리기는 브라우저가
 * 비공개 저장소로 직접 올리고(`uploadMemberDocumentFile`) 끝나면 새 문서로 승격한 뒤 서버 화면을 다시 그린다.
 * 새 문서는 편집기 화면이 필요해 PC 에서만 보인다(모바일은 올리기·미리보기·내려받기).
 */
export default function DocumentsList({
  documents,
  usage,
  newTypes,
}: {
  documents: DocumentListItem[]
  usage: DocumentUsage
  newTypes: { type: MemberNewDocumentType; label: string }[]
}) {
  const router = useRouter()
  const desktop = useDesktopEditor()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const ratio = quotaRatio(usage.total, usage.quota)
  const percent = Math.round(ratio * 100)
  const nearlyFull = ratio >= 0.9

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    setDone(null)
    const list = Array.from(files)
    let created = 0
    for (const file of list) {
      if (file.size > MEMBER_DOCUMENT_MAX_FILE_BYTES) {
        setError(`‘${file.name}’ — 파일 한 개는 50MB까지 올릴 수 있습니다.`)
        continue
      }
      try {
        setBusy(`‘${file.name}’ 올리는 중… 0%`)
        const uploadId = await uploadMemberDocumentFile(file, {
          onProgress: r => setBusy(`‘${file.name}’ 올리는 중… ${Math.round(r * 100)}%`),
        })
        setBusy(`‘${file.name}’ 저장하는 중…`)
        await createMemberDocument(uploadId, 'upload')
        created++
      } catch (e) {
        setError(`‘${file.name}’ — ${e instanceof Error ? e.message : '올리지 못했습니다.'}`)
      }
    }
    setBusy(null)
    if (input.current) input.current.value = ''
    if (created > 0) {
      setDone(created === 1 ? '문서를 올렸습니다.' : `문서 ${created}개를 올렸습니다.`)
      router.refresh()
    }
  }

  return (
    <div className="space-y-6" data-testid="member-documents-list">
      <section aria-labelledby="md-usage-heading" className="rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="md-usage-heading" className="text-sm font-semibold text-gray-900">
            사용량
          </h2>
          <p className="text-sm text-gray-600" data-testid="member-documents-usage">
            {formatDocumentBytes(usage.total)} / {formatDocumentBytes(usage.quota)} ({percent}%)
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="문서함 사용량"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-3 h-2 w-full overflow-hidden rounded-sm bg-gray-200"
        >
          <div
            className={`h-full ${nearlyFull ? 'bg-red-400' : 'bg-[#fbd9a5]'}`}
            style={{ width: `${Math.max(ratio > 0 ? 1 : 0, percent)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          모든 버전의 크기를 합쳐 셉니다. 파일 한 개는 50MB까지, 1년 동안 열지 않은 문서는 알림 뒤
          30일이 지나면 지워집니다.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          id="member-documents-upload"
          data-testid="member-documents-upload-input"
          onChange={e => void onFiles(e.target.files)}
          disabled={busy !== null}
        />
        <label
          htmlFor="member-documents-upload"
          className={`tw-btn-primary inline-flex cursor-pointer items-center gap-2 ${busy ? 'pointer-events-none opacity-60' : ''}`}
        >
          <FiUpload aria-hidden="true" className="h-4 w-4" />
          파일 올리기
        </label>
        {desktop &&
          newTypes.map(t => (
            <Link
              key={t.type}
              href={{ pathname: '/mypage/documents/new', query: { type: t.type } }}
              className="tw-btn-secondary inline-flex items-center gap-2"
            >
              <FiFilePlus aria-hidden="true" className="h-4 w-4" />새 {t.label}
            </Link>
          ))}
      </div>

      <div aria-live="polite" className="min-h-[1.25rem] text-sm">
        {busy && (
          <p role="status" className="text-gray-600">
            {busy}
          </p>
        )}
        {!busy && done && (
          <p role="status" className="text-gray-700">
            {done}
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center">
          <FiFileText aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-gray-400" />
          <p className="text-sm text-gray-600">
            아직 문서가 없습니다. 파일을 올리거나 새 문서를 만들어 보세요.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">내 문서 목록</caption>
            <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  이름
                </th>
                <th scope="col" className="hidden w-28 px-4 py-2 font-medium sm:table-cell">
                  형식
                </th>
                <th
                  scope="col"
                  className="hidden w-24 px-4 py-2 text-right font-medium sm:table-cell"
                >
                  크기
                </th>
                <th scope="col" className="hidden w-44 px-4 py-2 font-medium md:table-cell">
                  고친 때
                </th>
                <th scope="col" className="w-14 px-4 py-2 text-right font-medium">
                  <span className="sr-only">내려받기</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr
                  key={doc.id}
                  className="border-b border-gray-200 last:border-b-0"
                  data-testid="member-document-row"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/mypage/documents/${doc.id}`}
                      className="block truncate font-medium text-gray-900 hover:underline"
                      title={doc.name}
                    >
                      {doc.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      v{doc.latestVersionNo}
                      {doc.versionCount > 1 ? ` · 버전 ${doc.versionCount}개` : ''}
                      <span className="sm:hidden">
                        {' '}
                        · {documentTypeLabel(doc.name)} · {formatDocumentBytes(doc.totalSize)}
                      </span>
                    </p>
                    {doc.deletionNotifiedAt && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-300">
                        <FiAlertTriangle aria-hidden="true" className="h-3 w-3" />
                        오래 열지 않아 곧 지워집니다 — 열면 보관됩니다
                      </p>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-gray-600 sm:table-cell">
                    {documentTypeLabel(doc.name)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-right text-gray-600 tabular-nums sm:table-cell">
                    {formatDocumentBytes(doc.totalSize)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-gray-600 md:table-cell">
                    {formatDocumentDate(doc.updatedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <a
                      href={memberDocumentFileUrl(doc.latestVersionId, { download: true })}
                      download={doc.name}
                      className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      aria-label={`${doc.name} 내려받기`}
                    >
                      <FiDownload aria-hidden="true" className="h-4 w-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
