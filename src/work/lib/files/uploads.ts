import { countPendingUploads, insertPendingUploads } from '@/db/queries/work/files'
import { loadChannelAccess, type WorkViewer } from '@/lib/server/boardWorkChannelAuth'
import { resolveMime } from './mime'
import { buildUploadPath, displayFileName } from './paths'
import { decideUploadToken, type UploadTokenDecision, type UploadTokenGrant } from './upload-rules'
import {
  MAX_PENDING_PER_USER,
  MAX_UPLOAD_MESSAGE,
  MULTIPART_THRESHOLD_BYTES,
  uploadRequestSchema,
  type ActionResult,
  type UploadTarget,
} from './schema'

/**
 * ① 업로드 준비(서버 전용) — 원본 kosmart-work `createUploadTargets`를 Blob 직접 업로드에 맞게 다시 썼다(설계 §7-2).
 * 토큰 라우트(`POST /api/board-room/work/uploads`, `type: 'prepare'`)가 게이트 뒤에 부른다.
 *
 * 채널 **멤버**(메시지를 쓸 수 있는 사람)만 — 원본 is_channel_member. 관리자도 비공개 채널을 읽을 수는 있지만 멤버가
 * 아니면 올리지 못한다(메시지도 못 쓴다). 보관된 채널도 막는다(원본 harden_attachments_write).
 * 파일마다 서버가 키(`board-work/files/<uploadId>/<안전 이름>`)·형식을 정하고 `work_pending_uploads` 행을 만든다.
 * 브라우저는 그 키로만 토큰을 받을 수 있다(`authorizeUploadToken`).
 */
export async function prepareUploads(
  viewer: WorkViewer,
  input: unknown,
  opts: { storeReady: boolean }
): Promise<ActionResult<UploadTarget[]> & { status?: number }> {
  const parsed = uploadRequestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: `파일 정보가 올바르지 않습니다. ${MAX_UPLOAD_MESSAGE}`, status: 400 }
  }
  const { channelId, files } = parsed.data

  const access = await loadChannelAccess(viewer, channelId)
  if (!access || !access.isMember || access.archived) {
    return { ok: false, error: '이 채널에 파일을 올릴 권한이 없습니다.', status: 403 }
  }
  // 권한을 본 뒤에 저장소 설정을 본다(권한 없는 사람에게 설정 상태를 알리지 않는다). 미설정이면 행을 만들지 않는다
  if (!opts.storeReady) {
    return { ok: false, error: '파일 저장소가 설정되지 않았습니다.', status: 503 }
  }

  if ((await countPendingUploads(viewer.userId)) + files.length > MAX_PENDING_PER_USER) {
    return {
      ok: false,
      error: '전송하지 않은 첨부가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      status: 429,
    }
  }

  const targets: UploadTarget[] = []
  const rows = files.map((file, index) => {
    const uploadId = crypto.randomUUID()
    const pathname = buildUploadPath(uploadId, file.name)
    const mime = resolveMime(file.mime, file.name)
    targets.push({
      uploadId,
      index,
      pathname,
      mime,
      multipart: file.size > MULTIPART_THRESHOLD_BYTES,
    })
    return {
      id: uploadId,
      channelId,
      uploaderId: viewer.userId,
      blobPath: pathname,
      name: displayFileName(file.name),
      mime,
      size: file.size,
    }
  })
  // 상한을 같은 트랜잭션에서 다시 센다(동시 호출 둘이 위 사전 검사를 함께 통과한 경우)
  const inserted = await insertPendingUploads(rows, { maxPerUser: MAX_PENDING_PER_USER })
  if (!inserted) {
    return {
      ok: false,
      error: '전송하지 않은 첨부가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      status: 429,
    }
  }
  return { ok: true, data: targets }
}

export { decideUploadToken, type UploadTokenDecision, type UploadTokenGrant }
