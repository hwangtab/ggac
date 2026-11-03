import type {
  workChannelMembers,
  workChannels,
  workMessages,
  workReactions,
} from '@/db/schema/work'

/**
 * 원본 kosmart-work `src/types/supabase.ts`(Supabase 생성 타입) 자리 — 옮긴 파일이
 * `Database['work']['Tables'][…]['Row']`·`Database['work']['Enums'][…]`를 **고치지 않고** 쓰게 한다.
 *
 * Row는 Drizzle 스키마(`src/db/schema/work.ts`)에서 **유도한다**: 열 이름은 snake_case, 시각(Date)은 ISO 문자열 —
 * 원본 PostgREST가 돌려주던 모양이고, 쿼리 계층(`src/db/queries/work/*`)이 경계에서 그렇게 바꿔 준다.
 * enum 열은 원본처럼 좁힌다(DB는 text, 허용값은 zod가 정본).
 *
 * 스키마에 없는 표:
 * - `staff`: 구성원 표를 두지 않는다(설계 §3) — 화면이 읽는 열만 원본 모양으로 손으로 둔다.
 * - `attachments`: 2단계(파일). 1단계는 첨부가 늘 빈 배열이라 모양만 원본 그대로 둔다.
 */

type CamelToSnake<S extends string> = S extends `${infer H}${infer T}`
  ? `${H extends Lowercase<H> ? H : `_${Lowercase<H>}`}${CamelToSnake<T>}`
  : S

type WireValue<V> = V extends Date ? string : V extends Date | null ? string | null : V

/** Drizzle select 행 → 원본 PostgREST 행 모양(snake_case · ISO 문자열) */
export type WireRow<T> = { [K in keyof T as CamelToSnake<K & string>]: WireValue<T[K]> }

type ChannelKind = 'public' | 'private' | 'dm'
type ChannelMemberRole = 'owner' | 'member'
type MessageKind = 'text' | 'system' | 'bot'
type StaffRole = 'owner' | 'admin' | 'member' | 'guest'
type StaffStatus = 'active' | 'invited' | 'left'

type Narrow<T, K extends keyof T, V> = Omit<T, K> & { [P in K]: V }

export type Database = {
  work: {
    Tables: {
      channels: {
        Row: Narrow<WireRow<typeof workChannels.$inferSelect>, 'kind', ChannelKind>
      }
      channel_members: {
        Row: Narrow<WireRow<typeof workChannelMembers.$inferSelect>, 'role', ChannelMemberRole>
      }
      messages: {
        Row: Narrow<WireRow<typeof workMessages.$inferSelect>, 'kind', MessageKind>
      }
      reactions: {
        Row: WireRow<typeof workReactions.$inferSelect>
      }
      staff: {
        Row: {
          user_id: string
          display_name: string
          title: string | null
          role: StaffRole
          status: StaffStatus
          status_emoji: string | null
          status_text: string | null
          status_until: string | null
        }
      }
      attachments: {
        Row: {
          id: string
          message_id: string
          channel_id: string
          uploader_id: string | null
          bucket_path: string
          name: string
          mime: string
          size: number
          width: number | null
          height: number | null
          created_at: string
          folder_path: string | null
          previous_attachment_id: string | null
          version_root_id: string | null
          version_no: number
          is_latest: boolean
        }
      }
    }
    Enums: {
      channel_kind: ChannelKind
      channel_member_role: ChannelMemberRole
      message_kind: MessageKind
      staff_role: StaffRole
      staff_status: StaffStatus
    }
  }
}
