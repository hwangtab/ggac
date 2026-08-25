import { deleteObject, getPrivateObject, putObject } from './blob'
import { blobPathForBoardDocument } from './boardDocuments'

export type BoardDocumentStream = {
  statusCode: number
  stream: ReadableStream | null
  contentType: string
  etag: string | null
}

/**
 * 이사회 문서는 비공개 Blob 저장소 한 곳에만 있다.
 *
 * 단계 4 Task 2가 서류 14건을 Supabase Storage → 비공개 Blob으로 복사하고
 * SHA-256까지 대조했고, Task 5가 Supabase 클라이언트를 전부 걷어내면서
 * 교차 제공자 폴백(`hasSupabaseServiceRole()` 게이트 + `fromSupabase`)도
 * 함께 사라졌다.
 *
 * 같은 경로에 덮어쓰지 않는다. 업로드 경로에 타임스탬프가 들어가므로
 * 충돌은 사실상 없고, 충돌한다면 그건 사고다.
 */
export async function putBoardDocument(
  filePath: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await putObject('private', blobPathForBoardDocument(filePath), body, contentType, false)
}

/**
 * `@vercel/blob`의 `del()`은 멱등이라 없는 객체에도 성공한다 — 그래서 여기서
 * 나오는 reject는 전부 진짜 실패다. 호출부가 삼키더라도 반드시 로그에 남긴다.
 */
export async function deleteBoardDocument(filePath: string): Promise<void> {
  await deleteObject('private', blobPathForBoardDocument(filePath))
}

/**
 * 라우트가 이미 권한(이사·감사·관리자)을 검사한 뒤 부른다. 없는 문서면 null.
 */
export async function getBoardDocumentStream(
  filePath: string,
  ifNoneMatch?: string
): Promise<BoardDocumentStream | null> {
  const result = await getPrivateObject(blobPathForBoardDocument(filePath), ifNoneMatch)
  return result ? { ...result, etag: result.etag ?? null } : null
}
