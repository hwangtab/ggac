import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import rateLimiterUtils from '@/utils/rateLimiter';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Rate limiting
    const rateLimitConfig = rateLimiterUtils.RATE_LIMIT_CONFIGS.AUTH_API;
    const rateLimitResult = await rateLimiterUtils.applyRateLimit(rateLimitConfig)(request);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      );
    }

    const commentId = params.id;
    
    // Authorization header에서 토큰 추출
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization header missing' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // 토큰으로 사용자 확인
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // 사용자가 승인된 회원인지 확인
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: 'Unauthorized - Member approval required' },
        { status: 403 }
      );
    }

    // 댓글이 존재하는지 확인
    const { data: comment, error: commentError } = await supabaseAdmin
      .from('comments')
      .select('id')
      .eq('id', commentId)
      .single();

    if (commentError || !comment) {
      return NextResponse.json(
        { error: 'Comment not found' },
        { status: 404 }
      );
    }

    // 좋아요 토글 실행
    const { data: result, error: toggleError } = await supabaseAdmin
      .rpc('toggle_comment_like', {
        p_comment_id: commentId,
        p_user_id: user.id
      });

    if (toggleError) {
      console.error('Error toggling comment like:', toggleError);
      return NextResponse.json(
        { error: 'Failed to toggle like' },
        { status: 500 }
      );
    }

    const likeResult = result?.[0];
    if (!likeResult) {
      return NextResponse.json(
        { error: 'No result from toggle function' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      liked: likeResult.liked,
      like_count: likeResult.like_count
    });

  } catch (error) {
    console.error('Error in comment like API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}