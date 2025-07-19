import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    
    // Check authentication and admin status
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, is_active, registration_status')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin || !profile?.is_active || profile?.registration_status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get total posts count
    const { count: totalPosts } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })

    // Get deleted posts count
    const { count: totalDeleted } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_deleted', true)

    // Get pinned posts count
    const { count: totalPinned } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_pinned', true)

    // Get category stats
    const { data: categoryData } = await supabase
      .from('posts')
      .select('category')
      .eq('is_deleted', false)

    const categoryStats = {
      공지: 0,
      잡담: 0,
      홍보: 0,
      건의: 0
    }

    if (categoryData) {
      categoryData.forEach(post => {
        if (post.category in categoryStats) {
          categoryStats[post.category as keyof typeof categoryStats]++
        }
      })
    }

    const stats = {
      totalPosts: totalPosts || 0,
      totalDeleted: totalDeleted || 0,
      totalPinned: totalPinned || 0,
      categoryStats
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Admin posts stats API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
