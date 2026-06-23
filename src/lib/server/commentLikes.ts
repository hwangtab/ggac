import type { SupabaseClient } from '@supabase/supabase-js'

export async function getUserLikedCommentIds(
  supabase: SupabaseClient,
  userId: string,
  commentIds: string[]
): Promise<Set<string>> {
  const uniqueCommentIds = Array.from(new Set(commentIds.filter(Boolean)))

  if (!userId || uniqueCommentIds.length === 0) {
    return new Set()
  }

  const { data, error } = await supabase
    .from('comment_likes')
    .select('comment_id')
    .eq('user_id', userId)
    .in('comment_id', uniqueCommentIds)

  if (error) {
    return new Set()
  }

  return new Set(
    ((data ?? []) as Array<{ comment_id?: string | null }>)
      .map(row => row.comment_id)
      .filter((commentId): commentId is string => Boolean(commentId))
  )
}
