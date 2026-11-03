'use client'

import { useEffect, useRef, useState } from 'react'
import { previewKindOf, TEXT_PREVIEW_MAX_BYTES } from '@work/lib/files/mime'
import { isLayoutFile, type RenderedDocument } from '@work/lib/files/render-types'
import { thumbnailLines } from '@work/lib/files/thumbnail-text'
import { cn } from '@work/lib/utils'
import FileIcon from './FileIcon'
import { fileUrl, namedFileUrl, type PreviewFile } from './FilePreviewBody'
import { layoutUrl, renderUrl } from './DocumentViewer'
import { renderPdfFirstPage } from './pdf-thumbnail'

/** PDF 썸네일을 시도하는 상한 — 첫 쪽을 그리려고 파일 전체를 받으므로(pdf-thumbnail 참조) 넘으면 아이콘 */
export const PDF_THUMB_MAX_BYTES = 15 * 1024 * 1024
/** 문서·시트 썸네일을 시도하는 상한(변환 라우트 상한 RENDER_MAX_BYTES 보다 작게 — 썸네일 때문에 큰 변환을 돌리지 않는다) */
export const DOCUMENT_THUMB_MAX_BYTES = 20 * 1024 * 1024

/** 종이 한 장의 윗부분 — 썸네일 칸 위쪽에 붙여 아래가 잘리게 둔다(문서 첫 쪽을 엿보는 모양) */
const PAPER = 'mt-3 w-3/5 self-start overflow-hidden rounded-t-w-lg bg-background shadow'

function Icon({ file }: { file: PreviewFile }) {
  return <FileIcon mime={file.mime} name={file.name} size={file.size} className="size-14" />
}

/** 글 썸네일(문서·시트·텍스트) — 앞부분 몇 줄을 작은 글씨로 */
function TextPaper({ file, lines, mono }: { file: PreviewFile; lines: string[]; mono?: boolean }) {
  if (lines.length === 0) return <Icon file={file} />
  return (
    <div role="img" aria-label={`${file.name} 첫 부분`} className={cn(PAPER, 'h-full px-3 py-2')}>
      <div
        aria-hidden="true"
        className={cn(
          'text-[7px] leading-[1.45] break-all whitespace-pre-wrap text-muted-foreground',
          mono && 'font-mono'
        )}
      >
        {lines.join('\n')}
      </div>
    </div>
  )
}

function PdfThumb({ file }: { file: PreviewFile }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current?.parentElement
    if (!canvas || !box) return
    const ctrl = new AbortController()
    const width = Math.max(120, Math.round(box.clientWidth * 0.6))
    renderPdfFirstPage(fileUrl(file.id), canvas, width, ctrl.signal)
      .then(() => {
        if (!ctrl.signal.aborted) setState('ready')
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        console.error('[FileThumbnail:pdf]', e)
        setState('error')
      })
    return () => ctrl.abort()
  }, [file.id])

  if (state === 'error') return <Icon file={file} />
  return (
    <div ref={boxRef} className="contents">
      {state === 'loading' && <Icon file={file} />}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${file.name} 첫 쪽`}
        className={cn(PAPER, 'h-auto', state === 'loading' && 'hidden')}
      />
    </div>
  )
}

type LinesState = { status: 'loading' } | { status: 'ready'; lines: string[] } | { status: 'error' }

/** 문서·시트 — 변환 라우트(Storage 캐시)의 Markdown 앞부분. 변환이 안 되면(암호·손상·과다 요청) 아이콘 */
function DocumentThumb({ file }: { file: PreviewFile }) {
  const [state, setState] = useState<LinesState>({ status: 'loading' })
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${renderUrl(file.id)}?purpose=thumb`, { signal: ctrl.signal })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const doc = (await res.json()) as RenderedDocument
        const md = doc.kind === 'document' ? doc.markdown : (doc.sheets[0]?.markdown ?? '')
        setState({ status: 'ready', lines: thumbnailLines(md) })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: 'error' })
      })
    return () => ctrl.abort()
  }, [file.id])
  if (state.status !== 'ready') return <Icon file={file} />
  return <TextPaper file={file} lines={state.lines} />
}

/**
 * HWP·HWPX — 원본 모양 첫 쪽 SVG(`?view=layout&page=1`, Storage 캐시). <img> 로 그리므로 SVG 안 스크립트는 돌지 않고,
 * 라우트도 sandbox CSP 를 붙인다. 레이아웃 렌더가 안 되면 글 썸네일로 물러난다.
 */
function LayoutThumb({ file }: { file: PreviewFile }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  if (state === 'error') return <DocumentThumb file={file} />
  return (
    <>
      {state === 'loading' && <Icon file={file} />}
      {/* eslint-disable-next-line @next/next/no-img-element -- 권한 확인이 필요한 앱 라우트의 SVG */}
      <img
        src={`${layoutUrl(file.id, 1)}&purpose=thumb`}
        alt={`${file.name} 첫 쪽`}
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
        className={cn(PAPER, 'h-auto', state === 'loading' && 'hidden')}
      />
    </>
  )
}

/** 텍스트 — 원문 앞부분(서식 해석 없이) */
function TextThumb({ file }: { file: PreviewFile }) {
  const [state, setState] = useState<LinesState>({ status: 'loading' })
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(namedFileUrl(file.id, file.name), { signal: ctrl.signal, cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setState({ status: 'ready', lines: thumbnailLines(await res.text(), { markdown: false }) })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: 'error' })
      })
    return () => ctrl.abort()
  }, [file.id, file.name])
  if (state.status !== 'ready') return <Icon file={file} />
  return <TextPaper file={file} lines={state.lines} mono />
}

/** 동영상 — 첫 장면(메타데이터만 받는다, 재생하지 않음) */
function VideoThumb({ file }: { file: PreviewFile }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Icon file={file} />
  return (
    <video
      src={`${fileUrl(file.id)}#t=0.1`}
      preload="metadata"
      muted
      playsInline
      aria-label={`${file.name} 첫 장면`}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full"
    />
  )
}

/**
 * 파일 상세 썸네일(부모가 칸·배경을 준다). 이미지는 sharp 썸네일, PDF 는 첫 쪽(pdf.js), HWP·HWPX 는 원본 모양 첫 쪽,
 * HML·DOCX·PPTX·XLSX 는 변환 결과 앞부분(변환 횟수는 `?purpose=thumb` 로 미리보기와 따로 센다), 텍스트는 원문 앞부분, 동영상은 첫 장면. 그 밖·실패·불러오는 중은 형식 아이콘.
 * 부모는 `key={file.id}` 를 줘서 파일이 바뀔 때 상태를 비운다.
 */
export default function FileThumbnail({ file }: { file: PreviewFile }) {
  const kind = previewKindOf(file.mime, file.name, file.size)
  if (kind === 'image') {
    return (
      // 서명 URL 로 302 되는 보호된 이미지라 next/image 최적화 대상이 아니다.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fileUrl(file.id, { thumb: true })}
        alt={file.name}
        className="max-h-full max-w-full object-contain"
      />
    )
  }
  if (kind === 'pdf' && file.size <= PDF_THUMB_MAX_BYTES) return <PdfThumb file={file} />
  if ((kind === 'document' || kind === 'sheet') && file.size <= DOCUMENT_THUMB_MAX_BYTES) {
    return isLayoutFile(file.name) ? <LayoutThumb file={file} /> : <DocumentThumb file={file} />
  }
  if (kind === 'text' && file.size <= TEXT_PREVIEW_MAX_BYTES) return <TextThumb file={file} />
  if (kind === 'video') return <VideoThumb file={file} />
  return <Icon file={file} />
}
