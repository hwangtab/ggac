import * as cheerio from 'cheerio'
import sharp from 'sharp'

export type ImageDim = { width: number; height: number }

/**
 * 우리 Vercel Blob 공개 저장소의 origin(scheme+host)을 반환한다.
 *
 * NOTE: `@/lib/storage/paths`의 `isBlobPublicUrl`과 같은 판정을 의도적으로
 * 인라인한다. 이 유틸은 `node --test`(타입 스트리핑)로 직접 import되어 단위
 * 테스트되는데, node ESM 리졸버는 `@/*` 경로 별칭을 해석하지 못한다
 * (ERR_MODULE_NOT_FOUND).
 *
 * 예전에는 NEXT_PUBLIC_SUPABASE_URL을 읽었다. Supabase 프로젝트가
 * 2026-09-01에 삭제되면서 DB에 남은 Supabase 절대 URL이 0건임을 실측해
 * 판정을 Blob origin 하나로 좁혔다.
 */
function getBlobOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** 우리 Blob 저장소에서 오는 이미지인지. 남의 origin 이미지는 치수 주입 대상이 아니다. */
export function isOurStorageImageUrl(src: string): boolean {
  const origin = getBlobOrigin()
  if (!origin) return false
  try {
    return new URL(src).origin === origin
  } catch {
    return false
  }
}

export async function resolveImageDimensions(src: string): Promise<ImageDim | null> {
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(buf).metadata()
    if (!meta.width || !meta.height) return null
    return { width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

export async function annotateImageDimensions(
  html: string,
  resolve: (src: string) => Promise<ImageDim | null> = resolveImageDimensions,
  opts: { concurrency?: number } = {}
): Promise<string> {
  try {
    // 프래그먼트로 로드해 html/body 래핑을 피한다(구조 보존)
    const $ = cheerio.load(html, null, false)
    const targets = $('img')
      .toArray()
      .filter(el => {
        const $el = $(el)
        if ($el.attr('width') != null || $el.attr('height') != null) return false
        const src = $el.attr('src')
        return !!src && isOurStorageImageUrl(src)
      })
    if (targets.length === 0) return html
    const concurrency = opts.concurrency ?? 4
    for (let i = 0; i < targets.length; i += concurrency) {
      await Promise.all(
        targets.slice(i, i + concurrency).map(async el => {
          const $el = $(el)
          // per-image best-effort: 리졸버가 (return-null 계약을 어기고) throw해도
          // 그 이미지만 스킵한다. 예외가 바깥 catch까지 전파되면 같은 호출에서 이미
          // 다른 이미지에 적용한 width/height까지 통째로 버려지므로 여기서 삼킨다.
          let dim: ImageDim | null = null
          try {
            dim = await resolve($el.attr('src') as string)
          } catch {
            dim = null
          }
          if (dim) {
            $el.attr('width', String(dim.width))
            $el.attr('height', String(dim.height))
          }
        })
      )
    }
    return $.html()
  } catch {
    // best-effort: 어떤 HTML 입력에도 throw하지 않는다(파싱 실패 시 원본 유지)
    return html
  }
}

/**
 * 저장 경로에서 호출하는 단일 진입점.
 *
 * `annotateImageDimensions`는 이미지마다 서버측 fetch+sharp를 수행하므로(이미지당 5s
 * 타임아웃·동시성 4), 이미지가 많은 글은 저장에 수 초가 더 걸릴 수 있다. 이 래퍼는
 * 전체 시간 예산(`budgetMs`, 기본 8s)을 두어 저장 지연을 상한으로 캡하고, 타임아웃이나
 * 어떤 예외에도 **원본 html을 그대로 반환**한다(저장은 절대 실패하지 않는다).
 *
 * `_annotate`는 테스트 전용 주입 훅이다(래퍼 자체의 예산/무예외 계약을 격리 검증).
 * 운영 코드에서는 넘기지 않으며, 그때는 실 리졸버를 쓰는 `annotateImageDimensions`가 쓰인다.
 */
export async function annotateImageDimensionsSafe(
  html: string,
  opts: { budgetMs?: number; _annotate?: (html: string) => Promise<string> } = {}
): Promise<string> {
  const budgetMs = opts.budgetMs ?? 8000
  const annotate = opts._annotate ?? annotateImageDimensions
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      annotate(html),
      new Promise<string>(resolve => {
        timer = setTimeout(() => resolve(html), budgetMs)
      }),
    ])
  } catch {
    return html
  } finally {
    // 승자가 정해지면 남은 타이머를 정리한다(테스트에서 프로세스가 붙잡히지 않도록).
    if (timer) clearTimeout(timer)
  }
}
