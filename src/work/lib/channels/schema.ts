import { z } from 'zod'
import { boundedArray } from '@work/lib/validation/bounded-array'

/**
 * 채널 입력 스키마 · slug 규칙. DB CHECK(0001)와 같은 한도:
 *   name 1~80자, topic ≤250자, slug ^[a-z0-9가-힣][a-z0-9가-힣_-]{0,79}$
 * 'use server' 파일은 async 함수만 export 할 수 있어 여기 둔다.
 */

export const uuidSchema = z.string().uuid('잘못된 식별자입니다.')

export const SLUG_PATTERN = /^[a-z0-9가-힣][a-z0-9가-힣_-]{0,79}$/
export const SLUG_MAX = 80

/**
 * 채널 이름 → slug 후보. 소문자화, 공백·구분자는 '-', 허용 밖 문자는 제거,
 * 첫 글자는 영숫자·한글이어야 한다. 비면 'channel'.
 */
export function toChannelSlug(name: string): string {
  const base = name
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[\s./\\·,]+/g, '-')
    .replace(/[^a-z0-9가-힣_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')
    .slice(0, SLUG_MAX)
  return base === '' ? 'channel' : base
}

/** base 와 이미 쓰인 slug 목록 → 쓸 수 있는 첫 slug(base, base-2, base-3 …) */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length)}${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, SLUG_MAX - 9)}-${Date.now().toString(36).slice(-8)}`
}

/**
 * 같은 이름 판정 키(QA #4). DB 부분 유니크 인덱스 channels_name_active_uidx 의
 * lower(btrim(name)) 과 같은 기준 — 앞뒤 공백·대소문자를 무시한다(NFC 로 맞춘 뒤 비교).
 */
export function channelNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase()
}

export const DUPLICATE_CHANNEL_NAME_MESSAGE = '같은 이름의 채널이 있습니다.'

/** 0013 의 부분 유니크 인덱스 이름 — insert/update 의 23505 가 이름 중복인지 가른다. */
export const CHANNEL_NAME_UNIQUE_INDEX = 'channels_name_active_uidx'

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, '채널 이름을 입력해 주세요.')
  .max(80, '채널 이름은 80자까지 쓸 수 있습니다.')

export const createChannelSchema = z.object({
  name: channelNameSchema,
  kind: z.enum(['public', 'private'], { message: '채널 종류를 골라 주세요.' }),
  topic: z
    .string()
    .trim()
    .max(250, '주제는 250자까지 쓸 수 있습니다.')
    .optional()
    .transform(v => (v ? v : null)),
  /** 카테고리(0044) — 없으면 기타. 기존 카테고리만 고를 수 있다(새로 만들기는 관리자 전용 액션) */
  categoryId: uuidSchema.nullish(),
  /** 만들면서 함께 넣을 사람(나는 자동으로 owner) */
  memberIds: boundedArray(uuidSchema, {
    max: 100,
    maxMessage: '한 번에 100명까지 초대할 수 있습니다.',
  }).optional(),
})
export type CreateChannelInput = z.input<typeof createChannelSchema>

export const channelIdInputSchema = z.object({ channelId: uuidSchema })

export const updateTopicSchema = z.object({
  channelId: uuidSchema,
  topic: z
    .string()
    .trim()
    .max(250, '주제는 250자까지 쓸 수 있습니다.')
    .transform(v => (v === '' ? null : v)),
})

export const updatePostPolicySchema = z.object({
  channelId: uuidSchema,
  policy: z.enum(['everyone', 'owners'], { message: '글쓰기 권한 값이 올바르지 않습니다.' }),
})

export const addMembersSchema = z.object({
  channelId: uuidSchema,
  userIds: boundedArray(uuidSchema, {
    min: 1,
    minMessage: '추가할 사람을 골라 주세요.',
    max: 50,
    maxMessage: '한 번에 50명까지 추가할 수 있습니다.',
  }),
})

export const toggleFlagSchema = z.object({
  channelId: uuidSchema,
  value: z.boolean(),
})

export const openDmSchema = z.object({ userId: uuidSchema })

/**
 * 그룹 만들기. userIds 는 본인을 뺀 상대(2~19명 — 본인 포함 3~20; 본인이 섞여 있어도 서버가 정리한다).
 * name 이 비면 이름 없는 그룹(channels.title = null). forceNew 는 같은 구성의 이름 없는 그룹이 있어도
 * 새로 만든다(Q2 "새 그룹으로 만들기").
 */
export const createGroupSchema = z.object({
  userIds: boundedArray(uuidSchema, {
    min: 2,
    minMessage: '두 명 이상을 골라 주세요.',
    max: 20,
    maxMessage: '그룹은 본인 포함 20명까지 만들 수 있습니다.',
  }),
  name: z
    .string()
    .trim()
    .max(80, '대화 이름은 80자까지 쓸 수 있습니다.')
    .optional()
    .transform(v => (v ? v : undefined)),
  forceNew: z.boolean().optional(),
})

export const addGroupMembersSchema = z.object({
  channelId: uuidSchema,
  userIds: boundedArray(uuidSchema, {
    min: 1,
    minMessage: '추가할 사람을 골라 주세요.',
    max: 19,
    maxMessage: '그룹은 본인 포함 20명까지 만들 수 있습니다.',
  }),
})

/** 이름 바꾸기. 빈 값이면 이름을 지운다(null → 참여자 나열). */
/** 그룹 채팅에서 내보내기(0016 후속 — 업무툴 관리자만) */
export const removeGroupMemberSchema = z.object({ channelId: uuidSchema, userId: uuidSchema })

export const renameGroupSchema = z.object({
  channelId: uuidSchema,
  name: z
    .string()
    .trim()
    .max(80, '대화 이름은 80자까지 쓸 수 있습니다.')
    .transform(v => (v === '' ? null : v)),
})

/** 카테고리 이름 — 앞뒤 공백 제거, 1~40자(DB CHECK 와 같다) */
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, '카테고리 이름을 입력해 주세요.')
  .max(40, '카테고리 이름은 40자까지 쓸 수 있습니다.')

export const createCategorySchema = z.object({ name: categoryNameSchema })
export const renameCategorySchema = z.object({ categoryId: uuidSchema, name: categoryNameSchema })
export const deleteCategorySchema = z.object({ categoryId: uuidSchema })
export const reorderCategoriesSchema = z.object({
  ids: boundedArray(uuidSchema, { min: 1, max: 200, maxMessage: '카테고리가 너무 많습니다.' }),
})
export const moveChannelCategorySchema = z.object({
  channelId: uuidSchema,
  categoryId: uuidSchema.nullable(),
})
