'use client'

/**
 * PDF 첫 쪽을 canvas 에 그린다(파일 상세 썸네일). pdf.js 는 브라우저에서만 돌고, 처음 필요할 때 동적으로 불러온다
 * — 서버 변환이 없으니 함수 비용·캐시가 없고, 자료실 목록 번들에도 들어가지 않는다.
 * 파일은 `/api/board-room/work/files/<id>`(서명 URL 로 302)를 한 번 받는다. Storage 는 Range 를 지원하지만 CORS 로
 * `Accept-Ranges` 를 노출하지 않아 pdf.js 가 조각 요청을 못 쓰고 전체를 한 요청으로 받는다(2026-10-26 실측) —
 * 그래서 크기 상한(PDF_THUMB_MAX_BYTES)을 둔다. 자동 선읽기·스트리밍은 끈다.
 */

type PdfJs = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfJs> | null = null

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist')
      .then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString()
        return pdfjs
      })
      .catch((e: unknown) => {
        pdfjsPromise = null // 다음 시도에서 다시 불러오게
        throw e
      })
  }
  return pdfjsPromise
}

/**
 * url 의 PDF 첫 쪽을 canvas 너비 cssWidth(px)에 맞춰 그린다. 실패하면 던진다(호출부가 아이콘으로 물러난다).
 * signal 이 끊기면 내려받기·렌더를 멈춘다.
 */
export async function renderPdfFirstPage(
  url: string,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  signal: AbortSignal
): Promise<void> {
  const pdfjs = await loadPdfJs()
  if (signal.aborted) return
  const task = pdfjs.getDocument({
    url,
    isEvalSupported: false,
    disableAutoFetch: true,
    disableStream: true,
  })
  const onAbort = () => void task.destroy()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    if (signal.aborted) return
    const base = page.getViewport({ scale: 1 })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr })
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d 컨텍스트 없음')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${cssWidth}px`
    await page.render({ canvasContext: ctx, viewport }).promise
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (!signal.aborted) void task.destroy()
  }
}
