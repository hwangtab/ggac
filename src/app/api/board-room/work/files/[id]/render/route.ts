import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { jsonError, readableAttachmentOr404, workClientFor } from '@work/lib/files/file-response'
import { renderFileResponse } from '@work/lib/files/render-response'
import { downloadObject } from '@work/lib/files/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 변환 타임아웃(30초)보다 넉넉히 — 다운로드·캐시 저장 시간 포함
export const maxDuration = 60

/**
 * GET /api/board-room/work/files/<attachment id>/render — 문서·시트 뷰어용 변환 결과(JSON).
 * `?view=layout`(쪽 목록) · `?view=layout&page=<n>`(쪽 SVG) · `?purpose=thumb`(파일 상세 썸네일 — 변환 횟수를 따로 센다).
 * 원본 kosmart-work `api/files/[id]/render`를 옮겼다(설계 §7-3).
 *
 * 변환·캐시·보호 장치는 `renderFileResponse`(src/work/lib/files/render-response.ts — 자료실 이사회 서류와 공용)에 있다.
 * 권한: requireBoardMember → 업무툴 역할 → 읽을 수 있는 채널의 지워지지 않은 메시지 첨부여야 한다(아니면 404 — 존재 여부
 * 비노출). 그 뒤에야 저장소를 읽는다. 결과는 비공개 Blob `board-work/renders/<id>-<변환기버전>.json`에 캐시한다.
 * 보호 장치는 원본 그대로: 크기 상한(RENDER_MAX_BYTES)·압축 폭탄 검사(zip-guard)·변환 시간 제한·결정적 실패 기억.
 * 사용자당 변환 횟수는 원본의 프로세스 메모리 대신 ggac 분산 리미터(WORK_RENDER·WORK_RENDER_THUMB)로 센다.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return jsonError(404, 'Not Found')

  const client = await workClientFor(auth.user.id)
  if (client instanceof NextResponse) return client
  const attachment = await readableAttachmentOr404(client, id)
  if (attachment instanceof NextResponse) return attachment

  return renderFileResponse(request, auth.user.id, {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    readOriginal: () => downloadObject(attachment.bucket_path),
  })
}
