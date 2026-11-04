'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertTriangle, FiArrowLeft, FiMonitor, FiSave } from 'react-icons/fi'
import { Link, useRouter } from '@/i18n/navigation'
import {
  addMemberDocumentVersion,
  createMemberDocument,
  markEditorUsed,
  memberDocumentFileUrl,
  uploadMemberDocumentFile,
  type PromoteResponse,
} from '@/lib/memberDocuments/client'
import HwpEditorFrame, {
  type HwpEditorHandle,
  type HwpEditorPhase,
} from '@work/components/files/hwp-edit/HwpEditorFrame'
import OfficeEditorFrame, {
  type OfficeEditorHandle,
  type OfficeEditorPhase,
} from '@work/components/files/office-edit/OfficeEditorFrame'
import { useDesktopEditorKnown } from '@work/components/files/office-edit/use-desktop-editor'
import { objectsDroppedMessage } from '@work/lib/files/doc-edit-types'

export type EditTarget =
  | { kind: 'existing'; documentId: string; versionId: string; versionNo: number }
  | { kind: 'new'; templatePath: string }

export type EditorKind =
  | { kind: 'office'; origin: string }
  | { kind: 'hwp'; studioUrl: string; format: 'hwp' | 'hwpx' }

/**
 * 내 문서 앱 안 편집 화면(docs/board-work/04-조합원-문서함.md §8·§9) — 머리줄(← 돌아가기 · 이름 · 버전 · 상태 · 저장) +
 * 업무툴 편집기 프레임(`OfficeEditorFrame`·`HwpEditorFrame` — 바이트만 주고받는다). 저장은 늘 새 버전이다: 저장본을 비공개
 * 저장소에 직접 올리고 → 새 문서(처음 저장)·새 버전으로 승격한다. HWP·HWPX 는 서버가 원본과 비교 검사한 뒤에만 버전이 된다.
 * 혼자 쓰는 문서함이라 업무툴의 '수정 중' 표시(checkout)는 없다 — 다른 탭에서 먼저 저장했으면 서버가 409 로 막는다.
 * PC 전용(업무툴 `DesktopOnlyGate`와 같은 판정). HWP·HWPX 는 rhwp 초기 단계 경고 띠를 늘 보인다.
 */
export default function DocumentEditScreen({
  target,
  editor,
  fileName,
  backHref,
}: {
  target: EditTarget
  editor: EditorKind
  fileName: string
  backHref: string
}) {
  const desktop = useDesktopEditorKnown()
  const router = useRouter()
  const office = useRef<OfficeEditorHandle>(null)
  const hwp = useRef<HwpEditorHandle>(null)
  const [phase, setPhase] = useState<OfficeEditorPhase | HwpEditorPhase>('loading')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(
    target.kind === 'existing' ? target.documentId : null
  )
  const [baseVersionNo, setBaseVersionNo] = useState<number | null>(
    target.kind === 'existing' ? target.versionNo : null
  )
  const [savedNo, setSavedNo] = useState<number | null>(null)
  const [shownName, setShownName] = useState(fileName)

  useEffect(() => markEditorUsed(), [])

  // 저장하지 않은 변경이 있으면 창 닫기·새로 고침을 한 번 묻는다
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // 원본 바이트는 처음 열 때의 버전으로 한 번만 받는다 — 저장 뒤에도 같은 편집기 문서로 계속 편집한다
  const sourceUrl =
    target.kind === 'existing'
      ? memberDocumentFileUrl(target.versionId, { download: true })
      : target.templatePath
  const loadBuffer = useCallback(async () => {
    const res = await fetch(sourceUrl, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.arrayBuffer()
  }, [sourceUrl])

  async function persist(file: File, stillDirty: boolean) {
    setError(null)
    setWarning(null)
    try {
      setSaving('저장본을 올리는 중…')
      const uploadId = await uploadMemberDocumentFile(file, {
        documentId: documentId ?? undefined,
        onProgress: r => setSaving(`저장본을 올리는 중… ${Math.round(r * 100)}%`),
      })
      setSaving(editor.kind === 'hwp' ? '저장본을 검사하는 중…' : '저장하는 중…')
      let saved: PromoteResponse
      if (!documentId) {
        saved = await createMemberDocument(uploadId, 'editor')
        setDocumentId(saved.documentId)
        // 주소만 편집 화면으로 바꾼다(라우터로 옮기면 편집기가 다시 로드된다) — 새로 고치면 이 문서가 열린다
        window.history.replaceState(
          null,
          '',
          window.location.pathname.replace(/\/new$/, `/${saved.documentId}/edit`)
        )
      } else {
        saved = await addMemberDocumentVersion(documentId, {
          uploadId,
          source: 'editor',
          baseVersionNo,
        })
      }
      setBaseVersionNo(saved.versionNo)
      setSavedNo(saved.versionNo)
      setShownName(saved.name)
      setDirty(stillDirty)
      if (saved.objectsDropped) {
        setWarning(
          `${objectsDroppedMessage(saved.objectsDropped)} 이전 버전은 버전 기록에서 되돌릴 수 있습니다.`
        )
      }
      if (editor.kind === 'hwp') await hwp.current?.markSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      setSaving(null)
    }
  }

  function onSaveClick() {
    setError(null)
    setSaving(editor.kind === 'hwp' ? '저장본을 검사하는 중…' : '편집기에서 내보내는 중…')
    if (editor.kind === 'hwp') hwp.current?.requestSave()
    else office.current?.requestSave()
  }

  function onBack() {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 그래도 나갈까요?')) return
    setDirty(false)
    router.push(documentId ? `/mypage/documents/${documentId}` : backHref)
  }

  const versionLabel = savedNo
    ? `v${savedNo}`
    : target.kind === 'existing'
      ? `v${target.versionNo}`
      : '새 문서'
  const status = saving
    ? saving
    : dirty
      ? '저장 안 된 변경'
      : savedNo
        ? savedNo === 1 && target.kind === 'new'
          ? '저장됨'
          : `저장됨 v${savedNo}`
        : phase === 'ready'
          ? '변경 없음'
          : '편집기를 불러오는 중…'

  if (desktop === null) return <div className="h-full" aria-hidden="true" />
  if (!desktop) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
        data-testid="desktop-only-notice"
      >
        <FiMonitor aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">PC에서 열어 주세요</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          문서 편집은 넓은 화면과 마우스가 있는 PC에서만 쓸 수 있습니다. 휴대전화에서는 미리 보고
          내려받을 수 있습니다.
        </p>
        <Link
          href={documentId ? `/mypage/documents/${documentId}` : backHref}
          className="tw-btn-secondary mt-2"
        >
          돌아가기
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="member-document-edit-screen">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FiArrowLeft aria-hidden="true" className="h-4 w-4" />
          돌아가기
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
          <span className="truncate" title={shownName}>
            {shownName}
          </span>
          <span className="shrink-0 rounded-sm border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {versionLabel}
          </span>
        </h1>
        <span
          role="status"
          aria-live="polite"
          className="whitespace-nowrap text-xs text-muted-foreground"
        >
          {status}
        </span>
        <button
          type="button"
          onClick={onSaveClick}
          disabled={phase !== 'ready' || saving !== null}
          className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          data-poster-keep=""
        >
          <FiSave aria-hidden="true" className="h-4 w-4" />
          {documentId ? '저장(새 버전)' : '저장'}
        </button>
      </header>

      {editor.kind === 'hwp' && (
        <div
          role="note"
          className="flex shrink-0 items-start gap-2 border-b bg-[#fbd9a5]/10 px-4 py-2 text-sm text-[#fbd9a5]"
          data-testid="hwp-editor-warning"
        >
          <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            한글 편집기(rhwp)는 아직 초기 단계입니다. 표·그림·글꼴이 원본과 다르게 저장될 수 있으니,
            제출하기 전에 저장한 파일을 내려받아 한컴오피스 한글에서 한 번 열어 확인해 주세요.
          </p>
        </div>
      )}
      {warning && (
        <p role="status" className="shrink-0 border-b px-4 py-2 text-sm text-[#fbd9a5]">
          {warning}
        </p>
      )}
      {error && (
        <p role="alert" className="shrink-0 border-b px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        {editor.kind === 'office' ? (
          <OfficeEditorFrame
            ref={office}
            origin={editor.origin}
            fileName={fileName}
            loadBuffer={loadBuffer}
            onPhase={setPhase}
            onDirtyChange={setDirty}
            onSaved={(file, info) => void persist(file, info.dirty)}
            onError={message => {
              setSaving(null)
              setError(message)
            }}
          />
        ) : (
          <HwpEditorFrame
            ref={hwp}
            studioUrl={editor.studioUrl}
            fileName={fileName}
            format={editor.format}
            loadBuffer={loadBuffer}
            onPhase={setPhase}
            onDirtyChange={setDirty}
            onSaved={file => void persist(file, false)}
            onError={message => {
              setSaving(null)
              setError(message)
            }}
          />
        )}
      </div>
    </div>
  )
}
