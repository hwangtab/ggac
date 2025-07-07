import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    
    try {
      await supabase.auth.exchangeCodeForSession(code)
      
      // 사용자 프로필 확인
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // 트리거가 실패한 경우 대비 - 프로필 생성 시도
          console.log('Profile not found for user:', user.id, 'attempting to create...');
          
          try {
            const { error: createError } = await supabase
              .from('member_profiles')
              .insert({
                id: user.id,
                email: user.email || '',
                display_name: user.user_metadata?.display_name || user.email || 'Unknown',
                real_name: user.user_metadata?.real_name || null,
                phone_number: user.user_metadata?.phone_number || null,
                birth_date: user.user_metadata?.birth_date || null,
                monthly_fee: user.user_metadata?.monthly_fee ? parseInt(user.user_metadata.monthly_fee) : null,
                bank_name: user.user_metadata?.bank_name || null,
                account_number: user.user_metadata?.account_number || null,
                account_holder: user.user_metadata?.account_holder || null,
                registration_status: 'pending',
                is_active: false
              });

            if (createError) {
              console.error('Profile creation failed:', createError);
              // 프로필 생성에 실패해도 승인 대기 페이지로 이동 (관리자가 수동으로 처리 가능)
            } else {
              console.log('Profile created successfully for user:', user.id);
            }
          } catch (insertError) {
            console.error('Profile insertion error:', insertError);
          }
          
          // 승인 대기 페이지로 바로 이동
          return NextResponse.redirect(`${requestUrl.origin}/register/pending`)
        }

        if (profile.registration_status === 'pending') {
          // 승인 대기 중
          return NextResponse.redirect(`${requestUrl.origin}/register/pending`)
        }

        if (profile.registration_status === 'approved' && profile.is_active) {
          // 승인된 조합원 - 게시판으로
          return NextResponse.redirect(`${requestUrl.origin}/board`)
        }

        // 거절되었거나 비활성화된 경우
        return NextResponse.redirect(`${requestUrl.origin}/register/rejected`)
      }
    } catch (error) {
      console.error('Auth callback error:', error)
    }
  }

  // 오류 발생 시 로그인 페이지로
  return NextResponse.redirect(`${requestUrl.origin}/login`)
}