import { ApiError } from '@/utils/apiWrapper'

/** 메모 본문 상한(글자). 메일 한 통 옆에 남기는 짧은 글이다. */
export const NOTE_MAX_CHARS = 2000

/** 메모 본문을 검증한다 — 앞뒤 공백을 털고 1~2000자. 평문으로만 저장하고 화면도 텍스트로만 그린다. */
export function readNoteBody(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) throw ApiError.badRequest('메모 내용을 입력해 주세요.')
  if (text.length > NOTE_MAX_CHARS) {
    throw ApiError.badRequest(`메모는 ${NOTE_MAX_CHARS}자까지 쓸 수 있습니다.`)
  }
  return text
}
