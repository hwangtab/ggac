'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { DownloadIcon, Loader2Icon } from 'lucide-work'
import { isSafeHref } from '@work/components/markdown/MessageMarkdown'
import { NoticeBanner } from '@work/components/layout/page'
import { buttonVariants } from '@work/components/ui/button'
import { sanitizeUserMarkdown } from '@work/lib/markdown/sanitize-markdown'
import {
  LAYOUT_MAX_PAGES,
  RENDER_ERROR_MESSAGE,
  SHEET_MAX_ROWS,
  isLayoutFile,
  isLayoutManifest,
  type LayoutManifest,
  type RenderErrorCode,
  type RenderedDocument,
  type RenderedSheet,
} from '@work/lib/files/render-types'
import { cn } from '@work/lib/utils'
import { useFileApiBase, WORK_FILE_API_BASE } from './file-api-base'

export type DocumentViewerFile = { id: string; name: string }

type State =
  | { status: 'loading' }
  | { status: 'ready'; doc: RenderedDocument }
  | { status: 'error'; code: RenderErrorCode; message: string }

const ERROR_CODES = new Set<string>(Object.keys(RENDER_ERROR_MESSAGE))

export function renderUrl(id: string, base: string = WORK_FILE_API_BASE): string {
  return `${base}/${id}/render`
}

/** HWP·HWPX 원본 모양 — manifest(`?view=layout`)·쪽 SVG(`&page=n`) */
export function layoutUrl(id: string, page?: number, base: string = WORK_FILE_API_BASE): string {
  return `${renderUrl(id, base)}?view=layout${page ? `&page=${page}` : ''}`
}

/**
 * 변환 결과를 그리는 공용 마크다운. MessageMarkdown 과 같은 규칙 —
 * raw HTML 비렌더(skipHtml), 그림은 불러오지 않고(데이터 URI 포함) 자리 표시, 링크는 안전 스킴만 + 새 창.
 */
const COMPONENTS: Components = {
  img({ alt }) {
    return alt ? <span className="text-muted-foreground">[이미지: {alt}]</span> : null
  },
  a({ href, children }) {
    if (!isSafeHref(href)) return <>{children}</>
    if (/^https?:/i.test(href.trim()) || href.trim().startsWith('//')) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
          {children}
        </a>
      )
    }
    return <a href={href}>{children}</a>
  },
}

const DOC_COMPONENTS: Components = {
  ...COMPONENTS,
  table({ children }) {
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 영역을 키보드로 움직이게 한다(원본과 같다)
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="표">
        <table>{children}</table>
      </div>
    )
  },
}

function Markdown({ content, components }: { content: string; components: Components }) {
  return (
    <ReactMarkdown
      remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkCjkFriendly]}
      skipHtml
      components={components}
    >
      {sanitizeUserMarkdown(content)}
    </ReactMarkdown>
  )
}

function Notice({ children, role }: { children: React.ReactNode; role?: 'status' | 'alert' }) {
  return (
    <p role={role} className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function TruncatedNotice({ file, limit }: { file: DocumentViewerFile; limit: string }) {
  const base = useFileApiBase()
  return (
    <p className="flex flex-wrap items-center gap-2 border-t bg-subtle px-3 py-2 text-xs text-muted-foreground">
      <span>{limit}</span>
      <a
        href={`${base}/${file.id}?download=1`}
        download={file.name}
        className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
      >
        <DownloadIcon aria-hidden="true" className="size-3" />
        전체 내려받기
      </a>
    </p>
  )
}

/** 시트 이름 탭(WAI-ARIA tabs — roving tabindex, ←/→/Home/End) + 가로·세로 스크롤 표(머리글 행 고정) */
function SheetsView({ sheets, file }: { sheets: RenderedSheet[]; file: DocumentViewerFile }) {
  const baseId = useId()
  const [active, setActive] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = sheets[Math.min(active, sheets.length - 1)]

  if (!current) return <Notice>표시할 시트가 없습니다.</Notice>

  function focusTab(i: number) {
    setActive(i)
    tabRefs.current[i]?.focus()
  }
  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = sheets.length - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1
    else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    focusTab(next)
  }

  const activeIndex = sheets.indexOf(current)
  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <div
        role="tablist"
        aria-label="시트"
        className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 pt-2"
      >
        {sheets.map((s, i) => {
          const selected = i === activeIndex
          return (
            <button
              key={`${i}-${s.name}`}
              ref={el => {
                tabRefs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={e => onKeyDown(e, i)}
              className={cn(
                'shrink-0 rounded-t-w-lg border border-b-0 px-3 py-1.5 text-sm whitespace-nowrap outline-none',
                selected
                  ? 'bg-background font-medium text-foreground'
                  : 'bg-subtle text-muted-foreground hover:text-foreground'
              )}
            >
              {s.name}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeIndex}`}
        aria-labelledby={`${baseId}-tab-${activeIndex}`}
        tabIndex={0}
        className={cn(
          'min-h-0 flex-1 overflow-auto outline-none',
          '[&_table]:w-max [&_table]:border-collapse [&_table]:text-[13px]',
          '[&_td]:max-w-[32rem] [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_td]:break-words [&_td]:whitespace-pre-wrap',
          '[&_th]:border [&_th]:bg-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-pre-wrap',
          '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10'
        )}
      >
        {current.markdown.trim() ? (
          <Markdown content={current.markdown} components={COMPONENTS} />
        ) : (
          <Notice>내용이 없는 시트입니다.</Notice>
        )}
      </div>
      {current.truncated && (
        <TruncatedNotice
          file={file}
          limit={
            current.bytesClipped
              ? '용량이 커서 표의 앞부분만 표시합니다. 전체는 내려받아 확인하세요.'
              : `앞 ${SHEET_MAX_ROWS.toLocaleString('ko-KR')}행만 표시합니다. 전체는 내려받아 확인하세요.`
          }
        />
      )}
    </div>
  )
}

/**
 * 한글(HWP·HWPX)·워드(DOCX)·엑셀(XLSX·XLS) 뷰어. HWP·HWPX 는 원본 모양(쪽별 SVG)을 기본으로 하고 텍스트 보기로 전환할 수 있다.
 * 그 밖에는 `/api/board-room/work/files/<id>/render` 의 변환 결과(JSON)를 표·제목을 살린 읽기용으로 그린다.
 */
export default function DocumentViewer({ file }: { file: DocumentViewerFile }) {
  return isLayoutFile(file.name) ? (
    <HwpViewer key={file.id} file={file} />
  ) : (
    <TextDocumentViewer file={file} />
  )
}

type LayoutState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: LayoutManifest }
  | { status: 'failed' }

/**
 * 쪽 이미지를 못 받았을 때 다시 시도하는 간격(ms). 아직 안 그린 쪽은 구간 렌더 요청이라 빠르게 훑으면
 * 변환 횟수 제한(429)에 걸릴 수 있다 — 제한 창(1분) 안에서 풀리도록 점점 늘린다. 너무 큰 쪽(404)은 서버가
 * 표식으로 바로 답하므로 다시 시도해도 렌더 비용이 없다.
 */
export const LAYOUT_PAGE_RETRY_DELAYS_MS = [3_000, 10_000, 25_000] as const

/** 쪽 하나 — 종이는 다크모드에서도 흰색. 비율은 manifest 크기로 미리 잡아 불러오는 동안 흔들리지 않는다. */
function LayoutPageView({
  file,
  page,
}: {
  file: DocumentViewerFile
  page: LayoutManifest['pages'][number]
}) {
  // attempt: 지금 img 가 몇 번째 시도인지(0 = 처음). waiting: 다음 시도를 기다리는 중
  const [attempt, setAttempt] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const [broken, setBroken] = useState(false)
  const base = useFileApiBase()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  function onError() {
    const delay = LAYOUT_PAGE_RETRY_DELAYS_MS[attempt]
    if (delay === undefined) {
      setBroken(true)
      return
    }
    setWaiting(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setWaiting(false)
      setAttempt(a => a + 1)
    }, delay)
  }

  function retryNow() {
    setBroken(false)
    setAttempt(a => a + 1)
  }

  // 다시 시도할 때는 주소를 바꿔 브라우저가 실패한 응답을 다시 쓰지 않게 한다(서버는 모르는 쿼리를 무시)
  const src = `${layoutUrl(file.id, page.page, base)}${attempt > 0 ? `&retry=${attempt}` : ''}`
  return (
    <figure className="m-0 flex flex-col items-center gap-1">
      <div
        // 종이 면(흰 바탕·검은 글자)은 의도다 — 포스터의 `bg-white`·`text-*` 재매핑을 비켜 간다
        data-poster-keep=""
        className="w-full overflow-hidden border bg-white text-black"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        {page.tooLarge ? (
          <p className="flex size-full items-center justify-center p-4 text-center text-sm">
            이 쪽은 너무 커서 표시할 수 없습니다.
          </p>
        ) : broken ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm">
            <p>이 쪽을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={retryNow}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              다시 시도
            </button>
          </div>
        ) : waiting ? (
          <p
            role="status"
            className="flex size-full items-center justify-center gap-2 p-4 text-center text-sm"
          >
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            잠시 뒤 다시 불러옵니다…
          </p>
        ) : (
          // SVG 는 반드시 <img> 로 — 문서 안 스크립트·외부 요청이 돌지 못한다(서버도 CSP sandbox 를 건다).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={attempt}
            src={src}
            alt={`${file.name} ${page.page}쪽`}
            loading="lazy"
            decoding="async"
            className="size-full"
            onError={onError}
          />
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">{page.page}쪽</figcaption>
    </figure>
  )
}

function LayoutView({ file, manifest }: { file: DocumentViewerFile; manifest: LayoutManifest }) {
  return (
    <div className="flex size-full min-h-0 flex-col bg-subtle">
      <div
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 영역을 키보드로 움직이게 한다(원본과 같다)
        tabIndex={0}
        role="region"
        aria-label={`${file.name} 원본 모양`}
        className="min-h-0 flex-1 overflow-auto p-4 outline-none"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {manifest.pages.map(p => (
            <LayoutPageView key={p.page} file={file} page={p} />
          ))}
        </div>
      </div>
      {manifest.warnings.length > 0 && (
        <NoticeBanner variant="bar">
          머리말·각주 등 일부 요소는 표시되지 않을 수 있습니다.
        </NoticeBanner>
      )}
      {manifest.truncated && (
        <TruncatedNotice
          file={file}
          limit={`문서가 길어 앞 ${LAYOUT_MAX_PAGES}쪽만 표시합니다. 전체는 내려받아 확인하세요.`}
        />
      )}
    </div>
  )
}

function HwpViewer({ file }: { file: DocumentViewerFile }) {
  const [layout, setLayout] = useState<LayoutState>({ status: 'loading' })
  const [mode, setMode] = useState<'layout' | 'text'>('layout')
  const base = useFileApiBase()

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(layoutUrl(file.id, undefined, base), { signal: ctrl.signal })
      .then(async res => {
        const body: unknown = res.ok ? await res.json().catch(() => null) : null
        setLayout(
          isLayoutManifest(body) ? { status: 'ready', manifest: body } : { status: 'failed' }
        )
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLayout({ status: 'failed' })
      })
    return () => ctrl.abort()
  }, [file.id, base])

  const failed = layout.status === 'failed'
  const showText = failed || mode === 'text'
  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      {failed ? (
        <NoticeBanner variant="bar" role="status">
          원본 모양으로 표시하지 못해 텍스트로 보여 줍니다.
        </NoticeBanner>
      ) : (
        <div
          role="group"
          aria-label="보기 방식"
          className="flex min-h-10 shrink-0 items-center gap-1 border-b px-4 pointer-coarse:min-h-11"
        >
          {(
            [
              ['layout', '원본 모양'],
              ['text', '텍스트'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'rounded-w-lg px-3 py-1 text-xs outline-none pointer-coarse:min-h-9',
                mode === value
                  ? 'bg-subtle font-medium text-subtle-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {showText ? (
          <TextDocumentViewer file={file} />
        ) : layout.status === 'ready' ? (
          <LayoutView file={file} manifest={layout.manifest} />
        ) : (
          <Notice role="status">
            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
            문서를 불러오는 중…
          </Notice>
        )}
      </div>
    </div>
  )
}

function TextDocumentViewer({ file }: { file: DocumentViewerFile }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const base = useFileApiBase()

  useEffect(() => {
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    fetch(renderUrl(file.id, base), { signal: ctrl.signal })
      .then(async res => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          const code: RenderErrorCode =
            body?.error && ERROR_CODES.has(body.error) ? (body.error as RenderErrorCode) : 'server'
          setState({ status: 'error', code, message: RENDER_ERROR_MESSAGE[code] })
          return
        }
        setState({ status: 'ready', doc: (await res.json()) as RenderedDocument })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        console.error('[DocumentViewer]', e)
        setState({ status: 'error', code: 'server', message: RENDER_ERROR_MESSAGE.server })
      })
    return () => ctrl.abort()
  }, [file.id, base])

  if (state.status === 'loading') {
    return (
      <Notice role="status">
        <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        문서를 불러오는 중…
      </Notice>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-1 p-8 text-center text-sm text-muted-foreground">
        <p role="alert">{state.message}</p>
        <p>다운로드해서 열어 주세요.</p>
      </div>
    )
  }
  if (state.doc.kind === 'sheets') {
    return <SheetsView key={file.id} sheets={state.doc.sheets} file={file} />
  }
  const doc = state.doc
  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <div
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 영역을 키보드로 움직이게 한다(원본과 같다)
        tabIndex={0}
        role="region"
        aria-label={`${file.name} 내용`}
        className="min-h-0 flex-1 overflow-auto p-4 outline-none"
      >
        {doc.markdown.trim() ? (
          <div className="prose prose-sm prose-p:my-2 prose-table:text-[13px] mx-auto max-w-3xl">
            <Markdown content={doc.markdown} components={DOC_COMPONENTS} />
          </div>
        ) : (
          <Notice>표시할 내용이 없는 문서입니다.</Notice>
        )}
      </div>
      {doc.truncated && <TruncatedNotice file={file} limit="문서가 길어 앞부분만 표시합니다." />}
    </div>
  )
}
