import { deleteObject, getPrivateObject, putObject } from './blob'
import { blobPathForBoardDocument, supabaseLocationForBoardDocument } from './boardDocuments'
import { currentProvider } from './paths'
import { deleteSupabaseObject, downloadSupabaseObject, putSupabaseObject } from './supabase'

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

  const failures: string[] = []
  if (blobResult.status === 'rejected') {
    failures.push('blob')
    console.warn(`[storage] blob 삭제 실패 ${blobPath}: ${String(blobResult.reason)}`)
  }
  if (supabaseResult.status === 'rejected') {
    failures.push('supabase')
    console.warn(`[storage] supabase 삭제 실패 ${bucket}/${key}: ${String(supabaseResult.reason)}`)
  }

  if (failures.length === 2) {
    throw new Error(`이사회 문서 삭제 실패: ${filePath}`)
  }
}

/**
 * 읽기는 양쪽을 본다. 복사와 제공자 전환 사이, 그리고 롤백 상황에서 객체가
 * 한쪽에만 있을 수 있는데 읽기는 부작용이 없으므로 폴백이 안전하다.
 * 현재 제공자를 먼저 보고, 없으면 반대쪽을 한 번 더 본다.
 */
export async function getBoardDocumentStream(
  filePath: string,
  ifNoneMatch?: string
): Promise<BoardDocumentStream | null> {
  const provider = currentProvider()

  if (provider === 'blob') {
    const result = await getPrivateObject(blobPathForBoardDocument(filePath), ifNoneMatch)
    if (result) return { ...result, etag: result.etag ?? null }
    return fromSupabase(filePath)
  }

  const supabaseResult = await fromSupabase(filePath)
  if (supabaseResult) return supabaseResult

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
