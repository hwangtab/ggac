'use client'

import { useEffect, useState } from 'react'
import { EmptyState } from '@work/components/layout/page'
import { previewKindOf, TEXT_PREVIEW_MAX_BYTES } from '@work/lib/files/mime'
import type { Attachment } from '@work/lib/files/schema'
import DocumentViewer from './DocumentViewer'
import FileIcon from './FileIcon'

export type PreviewFile = Pick<Attachment, 'id' | 'name' | 'mime' | 'size'>

export function fileUrl(id: string, opts: { thumb?: boolean; download?: boolean } = {}): string {
  const q = opts.thumb ? '?thumb=1' : opts.download ? '?download=1' : ''
  return `/api/board-room/work/files/${id}${q}`
}

/**
 * 미리보기용 주소 `/api/board-room/work/files/<id>/<원래 파일명>` — 서버가 내용을 직접 흘려보내므로 PDF 뷰어 제목이
 * 저장 경로(`<uuid>-<safe-name>`)가 아니라 원래 파일명이 된다(QA #21).
 */
export function namedFileUrl(id: string, name: string): string {
  return `/api/board-room/work/files/${id}/${encodeURIComponent(name)}`
}

type TextState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error'; message: string }

/** 텍스트(.txt/.md/.csv/.json/.log 등) 미리보기 — 내용을 받아 <pre> 로 그린다(마크다운·HTML 도 렌더하지 않고 원문 그대로) */
export function TextPreview({ file }: { file: PreviewFile }) {
  const tooLarge = file.size > TEXT_PREVIEW_MAX_BYTES
  const [state, setState] = useState<TextState>({ status: 'loading' })

  useEffect(() => {
    if (tooLarge) return
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    fetch(namedFileUrl(file.id, file.name), { signal: ctrl.signal, cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setState({ status: 'ready', text: await res.text() })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        console.error('[TextPreview]', e)
        setState({
          status: 'error',
          message: '내용을 불러오지 못했습니다. 다운로드해서 열어 주세요.',
        })
      })
    return () => ctrl.abort()
  }, [file.id, file.name, tooLarge])

  if (tooLarge) {
    return (
      <EmptyState
        compact
        title="1MB 가 넘는 텍스트는 미리 볼 수 없습니다. 다운로드해서 열어 주세요."
      />
    )
  }
  if (state.status === 'loading') {
    return (
      <div role="status">
        <EmptyState compact title="불러오는 중…" />
      </div>
    )
  }
  if (state.status === 'error') {
    return <EmptyState compact title={state.message} />
  }
  return (
    <pre
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 영역을 키보드로 움직이게 한다(원본과 같다)
      tabIndex={0}
      aria-label={`${file.name} 내용`}
      className="size-full overflow-auto bg-background p-4 text-left font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {state.text}
    </pre>
  )
}

const PLAY_ERROR = '이 브라우저에서 재생할 수 없습니다. 다운로드해서 열어 주세요.'

/**
 * 동영상·오디오 — 서명 URL(/api/board-room/work/files/<id>, 302)을 요소가 직접 받는다. Range 는 Storage 가 처리하고
 * 앱 함수로 스트림을 프록시하지 않는다. 코덱을 못 읽으면 onError 로 안내한다.
 */
function MediaPreview({ file, kind }: { file: PreviewFile; kind: 'video' | 'audio' }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <EmptyState compact title={PLAY_ERROR} />
  if (kind === 'video') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- 사용자가 올린 파일이라 자막 트랙이 없다
      <video
        src={fileUrl(file.id)}
        controls
        preload="metadata"
        aria-label={`${file.name} 재생`}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full bg-black"
      />
    )
  }
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4 p-8">
      <FileIcon mime={file.mime} name={file.name} size={file.size} className="size-16" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- 사용자가 올린 파일이라 자막 트랙이 없다 */}
      <audio
        src={fileUrl(file.id)}
        controls
        preload="metadata"
        aria-label={`${file.name} 재생`}
        onError={() => setFailed(true)}
        className="w-full"
      />
    </div>
  )
}

/**
 * 파일 미리보기 본문(라이트박스·파일 탭 공용). 이미지는 <img>, PDF 는 이름 붙은 same-origin 라우트를 <iframe>,
 * 동영상·오디오는 <video>·<audio>, 텍스트(txt·md·csv·tsv·log·json·xml·yaml·toml·ini·conf·sql·sh·py·js·ts·jsx·tsx·
 * css·html·htm·srt·vtt, 1MB 이하)는 <pre>(원문 — 렌더하지 않음), HWP·HWPX·HML·DOCX·PPTX·XLSX·XLS 는
 * 서버 변환 뷰어(DocumentViewer), 그 밖은 아이콘 + 다운로드 안내.
 * 부모는 `key={file.id}` 를 줘서 파일이 바뀔 때 상태를 비운다.
 */
export default function FilePreviewBody({
  file,
  padded = false,
  downloadVerb = '다운로드해서',
}: {
  file: PreviewFile
  /** 이미지 둘레 여백·스크롤(파일 탭) */
  padded?: boolean
  /** 미지원 안내의 동사("다운로드해서"/"내려받아") */
  downloadVerb?: string
}) {
  const preview = previewKindOf(file.mime, file.name, file.size)
  if (preview === 'image') {
    const img = (
      // 서명 URL 로 302 되는 보호된 이미지라 next/image 최적화 대상이 아니다.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fileUrl(file.id)}
        alt={file.name}
        className="max-h-full max-w-full object-contain"
      />
    )
    return padded ? (
      <div className="flex size-full items-center justify-center overflow-auto p-4">{img}</div>
    ) : (
      img
    )
  }
  if (preview === 'pdf') {
    return (
      <iframe
        key={file.id}
        src={namedFileUrl(file.id, file.name)}
        title={`${file.name} 미리보기`}
        className="size-full border-0 bg-background"
      />
    )
  }
  if (preview === 'video' || preview === 'audio') {
    return (
      <div className="flex size-full items-center justify-center">
        <MediaPreview key={file.id} file={file} kind={preview} />
      </div>
    )
  }
  if (preview === 'text') return <TextPreview key={file.id} file={file} />
  if (preview === 'document' || preview === 'sheet') {
    return <DocumentViewer key={file.id} file={file} />
  }
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
      <FileIcon mime={file.mime} name={file.name} size={file.size} className="size-16" />
      <p className="text-sm text-muted-foreground">
        이 형식은 미리보기를 지원하지 않습니다. {downloadVerb} 열어 주세요.
      </p>
    </div>
  )
}
