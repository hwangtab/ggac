import { deleteObject, getPrivateObject, hasPrivateBlobStore, putObject } from './blob'
import { blobPathForBoardDocument, supabaseLocationForBoardDocument } from './boardDocuments'
import { classifyDeleteEverywhereResults, currentProvider } from './paths'
import {
  deleteSupabaseObject,
  downloadSupabaseObject,
  hasSupabaseServiceRole,
  putSupabaseObject,
} from './supabase'

export type BoardDocumentStream = {
  statusCode: number
  stream: ReadableStream | null
  contentType: string
  etag: string | null
}

/** 현재 제공자에만 쓴다. 전환 중이라도 신규 업로드는 한 곳에만 있으면 된다. */
export async function putBoardDocument(
  filePath: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (currentProvider() === 'blob') {
    // 같은 경로에 덮어쓰지 않는다. 업로드 경로에 타임스탬프가 들어가므로
    // 충돌은 사실상 없고, 충돌한다면 그건 사고다.
    await putObject('private', blobPathForBoardDocument(filePath), body, contentType, false)
    return
  }
  const { bucket, key } = supabaseLocationForBoardDocument(filePath)
  await putSupabaseObject(bucket, key, body, contentType, false)
}

/**
 * 전환기 전용. 어느 제공자에 있든 지운다. 공개 쪽
 * `deletePublicObjectEverywhere`와 같은 이유로 존재한다 — 복사본이 양쪽에
 * 남아 있는 동안 한쪽만 지우면 삭제한 문서가 롤백 후 되살아난다.
 *
 * 두 SDK 모두 없는 객체에 에러를 던지지 않으므로 reject는 전부 진짜 실패다.
 * 한쪽만 실패하면 로그만 남기고, 둘 다 실패했을 때만 던진다.
 */
export async function deleteBoardDocumentEverywhere(filePath: string): Promise<void> {
  const blobPath = blobPathForBoardDocument(filePath)
  const { bucket, key } = supabaseLocationForBoardDocument(filePath)

  const [blobResult, supabaseResult] = await Promise.allSettled([
    deleteObject('private', blobPath),
    deleteSupabaseObject(bucket, key),
  ])

  // 판정은 공개 쪽 deletePublicObjectEverywhere와 같은 헬퍼를 쓴다. 직접
  // `failures.length === 2`로 세면 제공자가 늘거나 규칙이 바뀔 때 두 삭제 경로가
  // 소리 없이 갈라진다.
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    { provider: 'blob', result: blobResult },
    { provider: 'supabase', result: supabaseResult },
  ])

  for (const { provider, reason } of toLog) {
    const target = provider === 'blob' ? blobPath : `${bucket}/${key}`
    console.warn(`[storage] ${provider} 삭제 실패 ${target}: ${String(reason)}`)
  }
  if (shouldThrow) {
    throw new Error(`이사회 문서 삭제 실패: ${filePath}`)
  }
}

/**
 * 읽기는 양쪽을 본다. 복사와 제공자 전환 사이, 그리고 롤백 상황에서 객체가
 * 한쪽에만 있을 수 있는데 읽기는 부작용이 없으므로 폴백이 안전하다.
 * 현재 제공자를 먼저 보고, 없으면 반대쪽을 한 번 더 본다.
 *
 * 폴백은 반대쪽이 설정돼 있을 때만 시도한다. 전환 전(Blob 토큰 없음)이나 롤백
 * 후(service-role 키 없음)에는 반대쪽이 비어 있는 게 정상인데, 그대로 부르면
 * requireEnv/requireServerEnv가 던져서 "없는 문서" 요청이 404가 아니라 환경변수
 * 이름이 담긴 500으로 나간다.
 *
 * 반면 선택된 제공자(첫 번째 조회)는 감싸지 않는다 — 그쪽이 설정돼 있지 않다면
 * 조용히 404로 덮지 말고 그대로 드러나야 하는 운영 사고다.
 */
export async function getBoardDocumentStream(
  filePath: string,
  ifNoneMatch?: string
): Promise<BoardDocumentStream | null> {
  const provider = currentProvider()

  if (provider === 'blob') {
    const result = await getPrivateObject(blobPathForBoardDocument(filePath), ifNoneMatch)
    if (result) return { ...result, etag: result.etag ?? null }
    return hasSupabaseServiceRole() ? fromSupabase(filePath) : null
  }

  const supabaseResult = await fromSupabase(filePath)
  if (supabaseResult) return supabaseResult

  if (!hasPrivateBlobStore()) return null
  const result = await getPrivateObject(blobPathForBoardDocument(filePath), ifNoneMatch)
  return result ? { ...result, etag: result.etag ?? null } : null
}

async function fromSupabase(filePath: string): Promise<BoardDocumentStream | null> {
  const { bucket, key } = supabaseLocationForBoardDocument(filePath)
  const downloaded = await downloadSupabaseObject(bucket, key)
  if (!downloaded) return null
  return {
    statusCode: 200,
    stream: downloaded.body.stream(),
    contentType: downloaded.contentType,
    // Supabase download는 ETag를 돌려주지 않는다. 조건부 요청은 Blob에서만 된다.
    etag: null,
  }
}
