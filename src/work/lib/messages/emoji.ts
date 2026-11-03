/** 반응 피커의 고정 12종(브리프 §5). 다른 이모지는 유니코드로 직접 입력한다. */
export const REACTION_EMOJIS = [
  '👍',
  '❤️',
  '😂',
  '🎉',
  '🙏',
  '👀',
  '✅',
  '🙌',
  '😮',
  '😢',
  '🔥',
  '💯',
] as const

export const REACTION_EMOJI_LABEL: Record<(typeof REACTION_EMOJIS)[number], string> = {
  '👍': '좋아요',
  '❤️': '하트',
  '😂': '웃음',
  '🎉': '축하',
  '🙏': '감사',
  '👀': '확인 중',
  '✅': '완료',
  '🙌': '만세',
  '😮': '놀람',
  '😢': '슬픔',
  '🔥': '불꽃',
  '💯': '백점',
}

export function emojiLabel(emoji: string): string {
  return (REACTION_EMOJI_LABEL as Record<string, string>)[emoji] ?? emoji
}
