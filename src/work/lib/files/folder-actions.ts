'use server'

import { z } from 'zod'
import { listSubfolderCounts } from '@/db/queries/work/files'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { dbFailure, invalid, ok, type ActionResult } from '@work/lib/channels/action-result'
import { toChannelFolders, type ChannelFolder } from './channel-files'
import { isValidFolderPath } from './folders'

/**
 * 자료실 목록 패널의 폴더 트리가 한 폴더씩 지연 로드할 때 부르는 서버 액션.
 * 가드(requireWorkStaff) → zod → 읽기 범위(원본 RLS)를 계산해 쿼리 계층에 넘긴다(원본 RPC `channel_subfolders` 자리).
 * 읽을 수 없는 채널이면 빈 목록이다.
 */
const inputSchema = z.object({
  channelId: z.string().uuid('잘못된 채널입니다.'),
  /** 루트는 '' — 그 밖에는 DB CHECK 와 같은 폴더 경로 규칙 */
  path: z
    .string()
    .refine(p => p === '' || isValidFolderPath(p), '잘못된 폴더 경로입니다.')
    .default(''),
})

export async function listChannelFolders(input: unknown): Promise<ActionResult<ChannelFolder[]>> {
  const ctx = await requireWorkStaff()
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { channelId, path } = parsed.data

  try {
    // 읽을 수 없는 채널이면 빈 목록(원본: RLS 가 빈 결과)
    const readable = await readableChannelIds(viewerOf(ctx))
    return ok(toChannelFolders(await listSubfolderCounts(channelId, path, readable), path))
  } catch (e) {
    return dbFailure('listChannelFolders', e)
  }
}
