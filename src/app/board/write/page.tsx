import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import type { MemberProfile } from '@/types'
import WritePageClient from './WritePageClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function WritePage() {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?redirect=/board/write')
  }

  const { data: profile } = await supabase
    .from('member_profiles')
    .select('registration_status, is_active')
    .eq('id', user.id)
    .single()

  const typedProfile = profile as Pick<MemberProfile, 'registration_status' | 'is_active'> | null
  const isMember =
    typedProfile?.registration_status === 'approved' && typedProfile?.is_active === true

  if (!isMember) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-yellow-800 mb-4">접근 권한이 없습니다</h1>
              <p className="text-yellow-700 mb-4">
                게시글 작성은 승인된 조합원만 가능합니다. 조합원 승인을 기다려주세요.
              </p>
              <Link
                href="/board"
                className="inline-block bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
              >
                게시판으로 돌아가기
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <WritePageClient userId={user.id} />
}
