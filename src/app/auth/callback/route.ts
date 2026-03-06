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
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        // 로그인 활동 로깅
        try {
          const ip =
            request.headers.get('x-forwarded-for')?.split(',')[0] ||
            request.headers.get('x-real-ip') ||
            '127.0.0.1'
          const userAgent = request.headers.get('user-agent') || 'Unknown'

          // 1. 세션 시작 기록
          const sessionToken = `session_${user.id}_${Date.now()}`
          await supabase.rpc('manage_user_session', {
            p_user_id: user.id,
            p_session_token: sessionToken,
            p_action: 'start',
            p_ip_address: ip,
            p_user_agent: userAgent,
            p_metadata: {
              login_method: 'oauth',
              callback_url: requestUrl.toString(),
              timestamp: new Date().toISOString(),
            },
          })

          // 2. 로그인 활동 기록 (리포트용)
          await supabase.rpc('log_user_activity', {
            p_user_id: user.id,
            p_action_type: 'login',
            p_target_type: 'system',
            p_target_id: null,
            p_metadata: {
              login_method: 'oauth',
              callback_url: requestUrl.toString(),
              session_token: sessionToken,
              timestamp: new Date().toISOString(),
            },
            p_ip_address: ip,
            p_user_agent: userAgent,
            p_session_id: sessionToken,
          })

          console.log(`로그인 활동 기록됨: 사용자 ${user.id}`)
        } catch (activityError) {
          console.error('Login activity logging failed:', activityError)
        }

        const { data: profile } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // 트리거가 실패한 경우 대비 - 프로필 생성 시도
          console.log('Profile not found for user:', user.id, 'attempting to create...')

          try {
            const { error: createError } = await supabase.from('member_profiles').insert({
              id: user.id,
              email: user.email || '',
              display_name: user.user_metadata?.display_name || user.email || 'Unknown',
              real_name: user.user_metadata?.real_name || null,
              phone_number: user.user_metadata?.phone_number || null,
              birth_date: user.user_metadata?.birth_date || null,
              monthly_fee: user.user_metadata?.monthly_fee
                ? parseInt(user.user_metadata.monthly_fee)
                : null,
              bank_name: user.user_metadata?.bank_name || null,
              account_number: user.user_metadata?.account_number || null,
              account_holder: user.user_metadata?.account_holder || null,
              registration_status: 'pending',
              is_active: false,
            })

            if (createError) {
              console.error('Profile creation failed:', createError)
              // 프로필 생성에 실패해도 승인 대기 페이지로 이동 (관리자가 수동으로 처리 가능)
            } else {
              console.log('Profile created successfully for user:', user.id)
            }
          } catch (insertError) {
            console.error('Profile insertion error:', insertError)
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
