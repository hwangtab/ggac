'use client'

import { useRef, useState, type FormEvent } from 'react'
import {
  FiArrowLeft,
  FiDownload,
  FiEdit3,
  FiMonitor,
  FiRotateCcw,
  FiTrash2,
  FiUpload,
  FiEye,
} from 'react-icons/fi'
import { Link, useRouter } from '@/i18n/navigation'
import {
  addMemberDocumentVersion,
  deleteMemberDocument,
  documentTypeLabel,
  formatDocumentBytes,
  formatDocumentDate,
  MEMBER_DOCUMENT_FILE_API_BASE,
  memberDocumentFileUrl,
  renameMemberDocument,
  restoreMemberDocumentVersion,
  uploadMemberDocumentFile,
} from '@/lib/memberDocuments/client'
import FilePreviewBody from '@work/components/files/FilePreviewBody'
import { FileApiBaseContext } from '@work/components/files/file-api-base'
import { useDesktopEditor } from '@work/components/files/office-edit/use-desktop-editor'

export type DetailVersion = {
  id: string
  versionNo: number
  name: string
  mime: string
  size: number
  source: string
  createdAt: string
}

const SOURCE_LABEL: Record<string, string> = {
  upload: '올림',
  editor: '앱에서 편집',
  restore: '되돌림',
}

/**
 * 내 문서 하나(docs/board-work/04-조합원-문서함.md §8) — 미리보기(업무툴 `FilePreviewBody`를 `data-work-app` 칸 안에,
 * API 기준 경로만 문서함으로)·내려받기·이름 바꾸기·새 버전 올리기·지우기·버전 기록(되돌리기). 편집은 PC 에서만.
 */
export default function DocumentDetail({
  document,
  versions,
  canEdit,
}: {
  document: { id: string; name: string; latestVersionNo: number; updatedAt: string }
  versions: DetailVersion[]
  canEdit: boolean
}) {
  const router = useRouter()
  const desktop = useDesktopEditor()
  const latest = versions.find(v => v.versionNo === document.latestVersionNo) ?? versions[0]
  const [selectedId, setSelectedId] = useState(latest?.id)
  const selected = versions.find(v => v.id === selectedId) ?? latest
  const [renaming, setRenaming] = useState(false)
  const [nameInput, setNameInput] = useState(document.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function run(label: string, task: () => Promise<string | null>) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      const done = await task()
      if (done) setNotice(done)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault()
    await run('이름을 바꾸는 중…', async () => {
      const r = await renameMemberDocument(document.id, nameInput)
      setRenaming(false)
      setNameInput(r.name)
      return '이름을 바꿨습니다.'
    })
  }

  async function onNewVersion(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    await run(`‘${file.name}’ 올리는 중…`, async () => {
      const uploadId = await uploadMemberDocumentFile(file, {
        documentId: document.id,
        onProgress: r => setBusy(`‘${file.name}’ 올리는 중… ${Math.round(r * 100)}%`),
      })
      const r = await addMemberDocumentVersion(document.id, {
        uploadId,
        source: 'upload',
        baseVersionNo: document.latestVersionNo,
      })
      setSelectedId(r.versionId)
      return `v${r.versionNo}을 올렸습니다.`
    })
    if (fileInput.current) fileInput.current.value = ''
  }

  async function onRestore(v: DetailVersion) {
    await run(`v${v.versionNo}으로 되돌리는 중…`, async () => {
      const r = await restoreMemberDocumentVersion(document.id, v.id)
      setSelectedId(r.versionId)
      return `v${v.versionNo}을 복사해 v${r.versionNo}으로 저장했습니다.`
    })
  }

  async function onDelete() {
    setBusy('지우는 중…')
    setError(null)
    try {
      await deleteMemberDocument(document.id)
      router.push('/mypage/documents')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했습니다.')
      setBusy(null)
    }
  }

  if (!latest || !selected) return null
  const disabled = busy !== null

  return (
    <div className="space-y-6" data-testid="member-document-detail">
      <Link
        href="/mypage/documents"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <FiArrowLeft aria-hidden="true" className="h-4 w-4" />내 문서함
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={onRename} className="flex flex-wrap items-center gap-2">
              <label htmlFor="md-rename" className="sr-only">
                새 이름
              </label>
              <input
                id="md-rename"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={120}
                className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                autoFocus
              />
              <button type="submit" className="tw-btn-primary" disabled={disabled}>
                바꾸기
              </button>
              <button
                type="button"
                className="tw-btn-secondary"
                onClick={() => {
                  setRenaming(false)
                  setNameInput(document.name)
                }}
              >
                취소
              </button>
            </form>
          ) : (
            <h2 className="break-all text-xl font-semibold text-gray-900">{document.name}</h2>
          )}
          <p className="mt-1 text-sm text-gray-500">
            v{latest.versionNo} · {documentTypeLabel(latest.name)} ·{' '}
            {formatDocumentBytes(latest.size)} · 고친 때 {formatDocumentDate(document.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && desktop && (
            <Link
              href={`/mypage/documents/${document.id}/edit`}
              className="tw-btn-primary inline-flex items-center gap-2"
            >
              <FiEdit3 aria-hidden="true" className="h-4 w-4" />
              앱에서 편집
            </Link>
          )}
          <a
            href={memberDocumentFileUrl(latest.id, { download: true })}
            download={latest.name}
            className="tw-btn-secondary inline-flex items-center gap-2"
          >
            <FiDownload aria-hidden="true" className="h-4 w-4" />
            내려받기
          </a>
        </div>
      </div>

      {canEdit && !desktop && (
        <p className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-600">
          <FiMonitor aria-hidden="true" className="h-4 w-4 shrink-0" />
          문서 편집은 PC에서 할 수 있습니다. 여기서는 미리 보고 내려받을 수 있습니다.
        </p>
      )}

      <div aria-live="polite" className="min-h-[1.25rem] text-sm">
        {busy && (
          <p role="status" className="text-gray-600">
            {busy}
          </p>
        )}
        {!busy && notice && (
          <p role="status" className="text-gray-700">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
      </div>

      <section aria-labelledby="md-preview-heading">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="md-preview-heading" className="text-sm font-semibold text-gray-900">
            미리보기 <span className="font-normal text-gray-500">v{selected.versionNo}</span>
          </h3>
          {selected.id !== latest.id && (
            <button
              type="button"
              className="text-sm text-gray-600 underline hover:text-gray-900"
              onClick={() => setSelectedId(latest.id)}
            >
              최신 버전 보기
            </button>
          )}
        </div>
        <div
          data-work-app
          className="relative flex h-[min(70vh,720px)] items-center justify-center overflow-hidden rounded border bg-card font-sans text-foreground"
          data-testid="member-document-preview"
        >
          <FileApiBaseContext.Provider value={MEMBER_DOCUMENT_FILE_API_BASE}>
            <FilePreviewBody
              key={selected.id}
              file={{
                id: selected.id,
                name: selected.name,
                mime: selected.mime,
                size: selected.size,
              }}
              downloadVerb="내려받아"
            />
          </FileApiBaseContext.Provider>
        </div>
      </section>

      <section aria-labelledby="md-versions-heading">
        <h3 id="md-versions-heading" className="mb-2 text-sm font-semibold text-gray-900">
          버전 기록
        </h3>
        <ol className="overflow-hidden rounded-lg border border-gray-200">
          {versions.map(v => (
            <li
              key={v.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 px-4 py-3 text-sm last:border-b-0"
              data-testid="member-document-version"
            >
              <span className="font-medium text-gray-900">v{v.versionNo}</span>
              {v.id === latest.id && (
                <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                  최신
                </span>
              )}
              <span className="text-gray-500">
                {formatDocumentDate(v.createdAt)} · {formatDocumentBytes(v.size)} ·{' '}
                {SOURCE_LABEL[v.source] ?? v.source}
              </span>
              <span className="ml-auto flex gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                  onClick={() => setSelectedId(v.id)}
                  aria-label={`v${v.versionNo} 미리보기`}
                  aria-pressed={v.id === selected.id}
                >
                  <FiEye aria-hidden="true" className="h-4 w-4" />
                </button>
                <a
                  href={memberDocumentFileUrl(v.id, { download: true })}
                  download={v.name}
                  className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                  aria-label={`v${v.versionNo} 내려받기`}
                >
                  <FiDownload aria-hidden="true" className="h-4 w-4" />
                </a>
                {v.id !== latest.id && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 disabled:opacity-50"
                    onClick={() => void onRestore(v)}
                    disabled={disabled}
                  >
                    <FiRotateCcw aria-hidden="true" className="h-4 w-4" />
                    되돌리기
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-gray-500">
          되돌리면 그 버전을 복사해 새 최신 버전으로 저장합니다. 지금까지의 버전은 그대로 남고
          용량에 함께 셉니다.
        </p>
      </section>

      <section
        aria-labelledby="md-manage-heading"
        className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-6"
      >
        <h3 id="md-manage-heading" className="sr-only">
          문서 관리
        </h3>
        <input
          ref={fileInput}
          id="md-new-version"
          type="file"
          className="sr-only"
          data-testid="member-document-version-input"
          onChange={e => void onNewVersion(e.target.files)}
          disabled={disabled}
        />
        <label
          htmlFor="md-new-version"
          className={`tw-btn-secondary inline-flex cursor-pointer items-center gap-2 ${disabled ? 'pointer-events-none opacity-60' : ''}`}
        >
          <FiUpload aria-hidden="true" className="h-4 w-4" />새 버전 올리기
        </label>
        {!renaming && (
          <button type="button" className="tw-btn-secondary" onClick={() => setRenaming(true)}>
            이름 바꾸기
          </button>
        )}
        {confirmDelete ? (
          <span className="flex flex-wrap items-center gap-2" role="group" aria-label="지우기 확인">
            <span className="text-sm text-gray-700">
              모든 버전이 지워지고 되돌릴 수 없습니다. 지울까요?
            </span>
            <button
              type="button"
              className="tw-btn-secondary text-red-400"
              onClick={() => void onDelete()}
              disabled={disabled}
            >
              지우기
            </button>
            <button
              type="button"
              className="tw-btn-secondary"
              onClick={() => setConfirmDelete(false)}
            >
              취소
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="tw-btn-secondary inline-flex items-center gap-2"
            onClick={() => setConfirmDelete(true)}
          >
            <FiTrash2 aria-hidden="true" className="h-4 w-4" />
            문서 지우기
          </button>
        )}
      </section>
    </div>
  )
}
