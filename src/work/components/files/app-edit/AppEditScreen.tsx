'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertTriangle, FiArrowLeft, FiMonitor, FiSave } from 'react-icons/fi'
import { Link, useRouter } from '@/i18n/navigation'
import HwpEditorFrame, {
  type HwpEditorHandle,
  type HwpEditorPhase,
} from '@work/components/files/hwp-edit/HwpEditorFrame'
import OfficeEditorFrame, {
  type OfficeEditorHandle,
  type OfficeEditorPhase,
} from '@work/components/files/office-edit/OfficeEditorFrame'
import { useDesktopEditorKnown } from '@work/components/files/office-edit/use-desktop-editor'
import { objectsDroppedMessage, type ObjectsDropped } from '@work/lib/files/doc-edit-types'
import type { AppEditorKind } from '@work/lib/files/app-edit'

export type AppEditSaveOutcome = {
  versionNo: number
  name: string
  objectsDropped?: ObjectsDropped
  /** 저장 뒤 '돌아가기'가 갈 곳이 바뀌었으면(새 문서를 처음 저장해 id 가 생겼다 등) */
  exitHref?: string
  /** 저장은 됐지만 알릴 것(웹 본문을 다시 만들지 못했다 등) */
  notice?: string
}

export type AppEditSave = (
  file: File,
  ctx: { baseVersionNo: number | null; report: (message: string) => void }
) => Promise<AppEditSaveOutcome>

/**
 * 업무툴 밖의 앱 안 편집 화면 공용 몸체 — 머리줄(← 돌아가기 · 이름 · 버전 · 상태 · 저장) + 업무툴 편집기 프레임
 * (`OfficeEditorFrame`·`HwpEditorFrame` — 바이트만 주고받는다). 조합원 내 문서함(04 §8 — `DocumentEditScreen`)과
 * 이사회 서류 앱 편집(05 §7 — `BoardDocumentEditScreen`)이 함께 쓴다. 저장은 늘 새 버전이고, 어떻게 올려 새 버전을 만드는지
 * (`save`)만 화면마다 다르다. HWP·HWPX 는 서버가 원본과 비교 검사한 뒤에만 버전이 된다.
 *
 * '수정 중' 표시(checkout)는 없다 — 다른 곳에서 먼저 저장했으면 서버가 409 로 막는다(`baseVersionNo`).
 * PC 전용(업무툴 `DesktopOnlyGate`와 같은 판정). HWP·HWPX 는 rhwp 초기 단계 경고 띠를 늘 보인다.
 */
export default function AppEditScreen({
  editor,
  fileName,
  sourceUrl,
  initialVersionNo,
  exitHref: initialExitHref,
  save,
  testId,
  onMount,
}: {
  editor: AppEditorKind
  fileName: string
  /** 편집기에 넣을 원본 바이트 주소(처음 열 때 한 번만 받는다) */
  sourceUrl: string
  /** 연 버전 번호. null 이면 아직 저장한 적 없는 새 문서 */
  initialVersionNo: number | null
  exitHref: string
  save: AppEditSave
  testId: string
  onMount?: () => void
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
  const [baseVersionNo, setBaseVersionNo] = useState<number | null>(initialVersionNo)
  const [savedNo, setSavedNo] = useState<number | null>(null)
  const [shownName, setShownName] = useState(fileName)
  const [exitHref, setExitHref] = useState(initialExitHref)
  const isNew = initialVersionNo === null
  const hasDocument = !isNew || savedNo !== null

  const mountRef = useRef(onMount)
  useEffect(() => mountRef.current?.(), [])

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
  const loadBuffer = useCallback(async () => {
    const res = await fetch(sourceUrl, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.arrayBuffer()
  }, [sourceUrl])

  async function persist(file: File, stillDirty: boolean) {
    setError(null)
    setWarning(null)
    try {
      const saved = await save(file, { baseVersionNo, report: setSaving })
      setBaseVersionNo(saved.versionNo)
      setSavedNo(saved.versionNo)
      setShownName(saved.name)
      if (saved.exitHref) setExitHref(saved.exitHref)
      setDirty(stillDirty)
      const notes: string[] = []
      if (saved.objectsDropped) {
        notes.push(
          `${objectsDroppedMessage(saved.objectsDropped)} 이전 버전은 버전 기록에서 되돌릴 수 있습니다.`
        )
      }
      if (saved.notice) notes.push(saved.notice)
      if (notes.length > 0) setWarning(notes.join(' '))
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
    router.push(exitHref)
  }

  const versionLabel = savedNo ? `v${savedNo}` : !isNew ? `v${initialVersionNo}` : '새 문서'
  const status = saving
    ? saving
    : dirty
      ? '저장 안 된 변경'
      : savedNo
        ? savedNo === 1 && isNew
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
        <Link href={exitHref} className="tw-btn-secondary mt-2">
          돌아가기
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid={testId}>
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
          {hasDocument ? '저장(새 버전)' : '저장'}
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
