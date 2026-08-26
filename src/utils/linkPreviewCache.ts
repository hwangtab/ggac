import type { LinkPreview } from '@/types'
import { getCachedLinkPreview, setCachedLinkPreview } from '@/db/queries/misc'

// Persistent cache backed by Turso (src/db/queries/misc.ts) — Task 4.
// 두 함수 모두 실패를 삼킨다(캐시 미스로 취급) — 캐시는 부가 기능이고, 이
// 실패가 실제 링크 미리보기 조회(스크래핑)를 막으면 안 된다. 원본
// Supabase 구현도 같은 계약이었다(try/catch로 감싸 null/무시).

export async function getCachedPreviewFromDB(url: string): Promise<LinkPreview | null> {
  try {
    const data = await getCachedLinkPreview(url)
    return (data as LinkPreview | null) ?? null
  } catch {
    return null
  }
}

export async function setCachedPreviewToDB(
  url: string,
  preview: LinkPreview,
  ttlSeconds: number = 21600
): Promise<void> {
  try {
    await setCachedLinkPreview(url, preview, ttlSeconds)
  } catch {
    // ignore
  }
}
