import { z } from 'zod'
import { NOTIFY_LEVELS } from './levels'
import { digestModeSchema, quietPrefsSchema } from './quiet-hours'

/** 서버 액션 입력 스키마('use server' 파일은 async 함수만 export 할 수 있어 여기 둔다). */
export const channelNotifyInputSchema = z.object({
  channelId: z.string().uuid('잘못된 식별자입니다.'),
  level: z.enum(NOTIFY_LEVELS),
})

export const notificationPrefsInputSchema = z.object({
  quiet: quietPrefsSchema,
  digestMode: digestModeSchema,
})
