import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { id } = params
    
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

    // Get action from request body
    const { action } = await request.json()

    if (!action || !['delete', 'restore', 'pin', 'unpin'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Get the post to check if it exists
    const { data: post } = await supabase
      .from('posts')
      .select('id, category, is_deleted, is_pinned')
      .eq('id', id)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Prepare update data based on action
    let updateData: any = {}

    switch (action) {
      case 'delete':
        if (post.is_deleted) {
          return NextResponse.json({ error: 'Post is already deleted' }, { status: 400 })
        }
        updateData = { is_deleted: true }
        break
      
      case 'restore':
        if (!post.is_deleted) {
          return NextResponse.json({ error: 'Post is not deleted' }, { status: 400 })
        }
        updateData = { is_deleted: false }
        break
      
      case 'pin':
        if (post.category !== '공지') {
          return NextResponse.json({ error: 'Only announcements can be pinned' }, { status: 400 })
        }
        if (post.is_pinned) {
          return NextResponse.json({ error: 'Post is already pinned' }, { status: 400 })
        }
        updateData = { 
          is_pinned: true,
          pinned_at: new Date().toISOString()
        }
        break
      
      case 'unpin':
        if (!post.is_pinned) {
          return NextResponse.json({ error: 'Post is not pinned' }, { status: 400 })
        }
        updateData = { 
          is_pinned: false,
          pinned_at: null
        }
        break
    }

    // Update the post
    const { data: updatedPost, error: updateError } = await supabase
      .from('posts')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Post update error:', updateError)
      return NextResponse.json({ error: 'Failed to update post' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      post: updatedPost,
      message: `Post ${action} successful`
    })
  } catch (error) {
    console.error('Admin post action API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
