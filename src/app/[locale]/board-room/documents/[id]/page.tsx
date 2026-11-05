'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import {
  BoardDocumentApiError,
  fetchBoardDocumentVersions,
  formatBoardDocumentBytes,
  formatBoardDocumentDate,
  revertBoardDocumentVersion,
  type BoardDocumentVersionsView,
  type BoardDocumentVersionView,
} from '@/lib/boardDocuments/client'
import {
  BOARD_DOCUMENT_SOURCE_LABEL,
  isBoardDocumentVersionSource,
} from '@/lib/boardDocuments/editRules'
import { isSafeInternalPath } from '@/utils/safeUrl'
import { useDesktopEditorKnown } from '@work/components/files/office-edit/use-desktop-editor'

function sourceLabel(source: string): string {
  return isBoardDocumentVersionSource(source) ? BOARD_DOCUMENT_SOURCE_LABEL[source] : source
}

/**
 * `/board-room/documents/[id]` — 이사회 서류 한 건과 버전 기록(docs/board-work/05-이사회-서류-앱-편집.md §4·§7).
 * 내려받기·'앱에서 편집'(올린 사람·관리자, PC, 편집기 env 가 있는 형식)·버전마다 저장한 사람과 때·지나간 버전 내려받기·
 * 되돌리기(그 버전을 복사해 새 버전 — 지나간 기록은 그대로). 데이터는 `/api/board-room/documents/<id>/versions`
 * (requireBoardMember — 조합원은 403)가 주고, 단추를 보일지와 상관없이 실제 차단은 각 API 가 한다.
 */
export default function BoardDocumentDetailPage() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id ?? '')
  const desktop = useDesktopEditorKnown()
  const [view, setView] = useState<BoardDocumentVersionsView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'missing' | 'error'>(
    'loading'
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setView(await fetchBoardDocumentVersions(id))
      setState('ready')
    } catch (e) {
      const status = e instanceof BoardDocumentApiError ? e.status : 0
      setState(
        status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'missing' : 'error'
      )
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function revert(v: BoardDocumentVersionView) {
    if (!v.id) return
    if (
      !window.confirm(
        `v${v.versionNo}을 복사해 새 버전으로 저장할까요? 지금 버전과 기록은 그대로 남습니다.`
      )
    )
      return
    setBusy(v.id)
    setNotice(null)
    try {
      const res = await revertBoardDocumentVersion(id, v.id)
      setNotice({
        kind: 'ok',
        text: res.message ?? `v${v.versionNo}을 복사해 v${res.data.versionNo}으로 저장했습니다.`,
      })
      await load()
    } catch (e) {
      setNotice({
        kind: 'error',
        text: e instanceof Error ? e.message : '되돌리지 못했습니다.',
      })
    } finally {
      setBusy(null)
    }
  }

  const back = (
    <div className="mb-6">
      <Link
        href="/board-room/documents"
        className="text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        ← 서류함으로
      </Link>
    </div>
  )

  if (state === 'loading') {
    return (
      <div className="mx-auto max-w-4xl pb-16">
        {back}
        <div className="mb-6 h-9 w-64 animate-pulse rounded bg-gray-100" />
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
      </div>
    )
  }
  if (state !== 'ready' || !view) {
    const message =
      state === 'forbidden'
        ? '버전 기록은 이사·감사·관리자만 볼 수 있습니다.'
        : state === 'missing'
          ? '서류를 찾을 수 없습니다.'
          : '서류를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
    return (
      <div className="mx-auto max-w-4xl pb-16">
        {back}
        <p
          role={state === 'error' ? 'alert' : 'status'}
          className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600"
          data-testid="board-document-detail-unavailable"
        >
          {message}
        </p>
      </div>
    )
  }

  const { document: doc, versions } = view
  const latest = versions.find(v => v.isLatest) ?? versions[0]
  const latestDownload =
    latest && isSafeInternalPath(latest.downloadUrl) ? latest.downloadUrl : null
  const canOpenEditor = doc.canEdit && doc.editableHere

  return (
    <div className="mx-auto max-w-4xl pb-16" data-testid="board-document-detail">
      {back}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {doc.category}
        </span>
        <span className="text-xs text-gray-500">
          {doc.visibility === 'members' ? '조합원 공개' : '이사회만'}
        </span>
      </div>
      <h1 className="mb-2 break-words text-2xl font-bold text-gray-900 md:text-3xl">{doc.title}</h1>
      <p className="mb-6 break-all text-sm text-gray-500">
        {doc.fileName}
        <span className="text-gray-400"> · {formatBoardDocumentBytes(doc.fileSize)}</span>
        <span className="text-gray-400"> · v{doc.latestVersionNo}</span>
      </p>

      <div className="mb-8 flex flex-wrap items-center gap-2">
        {latestDownload && (
          <a
            href={latestDownload}
            className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            내려받기
          </a>
        )}
        {canOpenEditor && desktop === true && (
          <Link
            href={`/board-room/documents/${doc.id}/edit`}
            className="whitespace-nowrap rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            앱에서 편집
          </Link>
        )}
      </div>
      {canOpenEditor && desktop === false && (
        <p className="-mt-6 mb-8 text-sm text-gray-500">
          서류 편집은 PC에서 할 수 있습니다. 여기서는 내려받을 수 있습니다.
        </p>
      )}
      {!doc.canEdit && doc.editableHere && (
        <p className="-mt-6 mb-8 text-sm text-gray-500">
          앱 편집은 이 서류를 올린 사람과 관리자만 할 수 있습니다.
        </p>
      )}
      {doc.hasBody && canOpenEditor && desktop === true && (
        <p className="-mt-6 mb-8 text-sm text-gray-500">
          웹 본문이 있는 서류입니다. 앱에서 저장하면 새 파일로 본문을 다시 만들고, 되돌리면 그
          버전의 본문이 돌아옵니다.
        </p>
      )}

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`mb-4 rounded-lg border p-3 text-sm ${
            notice.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-gray-200 bg-white text-gray-700'
          }`}
        >
          {notice.text}
        </p>
      )}

      <section aria-labelledby="board-document-versions-heading">
        <h2
          id="board-document-versions-heading"
          className="mb-3 text-sm font-semibold tracking-widest text-gray-400"
        >
          버전 기록
        </h2>
        <ol className="space-y-2">
          {versions.map(v => {
            const href = isSafeInternalPath(v.downloadUrl) ? v.downloadUrl : null
            return (
              <li
                key={v.id ?? `v${v.versionNo}`}
                data-testid="board-document-version"
                className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                    <span>v{v.versionNo}</span>
                    {v.isLatest && (
                      <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs font-normal text-gray-600">
                        최신
                      </span>
                    )}
                    <span className="text-xs font-normal text-gray-500">
                      {sourceLabel(v.source)}
                    </span>
                  </p>
                  <p className="mt-1 break-all text-xs text-gray-500">
                    {v.createdByName ?? '알 수 없음'} · {formatBoardDocumentDate(v.createdAt)} ·{' '}
                    {v.fileName} · {formatBoardDocumentBytes(v.fileSize)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {href && (
                    <a
                      href={href}
                      className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      aria-label={`v${v.versionNo} 내려받기`}
                    >
                      내려받기
                    </a>
                  )}
                  {doc.canEdit && !v.isLatest && v.id && (
                    <button
                      type="button"
                      onClick={() => void revert(v)}
                      disabled={busy !== null}
                      className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy === v.id ? '되돌리는 중…' : '되돌리기'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
        {versions.length === 1 && (
          <p className="mt-3 text-xs text-gray-500">
            아직 앱에서 고친 적이 없습니다. 처음 저장하면 지금 파일이 v1로 남고 새 파일이 v2가
            됩니다.
          </p>
        )}
      </section>
    </div>
  )
}
