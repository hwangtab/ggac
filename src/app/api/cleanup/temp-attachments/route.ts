/**
 * 임시 첨부파일 정리 API
 * 만료된 임시 첨부파일을 정리하는 cron job용 엔드포인트
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Service Role 클라이언트 (RLS 우회 가능)
function getSupabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * 임시 첨부파일 정리 실행
 */
export async function POST(request: NextRequest) {
  try {
    // 간단한 인증 (cron job용)
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CLEANUP_CRON_TOKEN

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[CLEANUP] 임시 첨부파일 정리 시작')

    const supabaseAdmin = getSupabaseAdmin()

    // 1. 만료된 임시 첨부파일 조회
    const { data: expiredAttachments, error: queryError } = await supabaseAdmin
      .from('post_attachments')
      .select('id, file_url, file_name')
      .eq('is_temporary', true)
      .lt('expires_at', new Date().toISOString())

    if (queryError) {
      console.error('[CLEANUP] 만료된 첨부파일 조회 실패:', queryError)
      return NextResponse.json(
        {
          error: 'Failed to query expired attachments',
        },
        { status: 500 }
      )
    }

    if (!expiredAttachments || expiredAttachments.length === 0) {
      console.log('[CLEANUP] 정리할 만료된 임시 첨부파일 없음')
      return NextResponse.json({
        message: 'No expired temporary attachments to clean up',
        cleaned: 0,
      })
    }

    console.log(`[CLEANUP] ${expiredAttachments.length}개의 만료된 임시 첨부파일 발견`)

    // 2. Storage에서 파일 삭제
    const filePaths = expiredAttachments
      .map(att => {
        // URL에서 파일 경로 추출
        const url = new URL(att.file_url)
        const pathParts = url.pathname.split('/')
        // /storage/v1/object/public/attachments/temp/... 형태에서 temp/... 부분 추출
        const bucketIndex = pathParts.indexOf('attachments')
        if (bucketIndex !== -1 && bucketIndex < pathParts.length - 1) {
          return pathParts.slice(bucketIndex + 1).join('/')
        }
        return null
      })
      .filter(Boolean) as string[]

    if (filePaths.length > 0) {
      console.log('[CLEANUP] Storage 파일 삭제 시작:', filePaths.length, '개')
      const { error: storageError } = await supabaseAdmin.storage
        .from('attachments')
        .remove(filePaths)

      if (storageError) {
        console.error('[CLEANUP] Storage 파일 삭제 실패:', storageError)
        // 스토리지 삭제 실패해도 계속 진행 (DB 정리는 수행)
      } else {
        console.log('[CLEANUP] Storage 파일 삭제 완료')
      }
    }

    // 3. 데이터베이스에서 레코드 삭제
    const expiredIds = expiredAttachments.map(att => att.id)
    const { error: deleteError } = await supabaseAdmin
      .from('post_attachments')
      .delete()
      .in('id', expiredIds)

    if (deleteError) {
      console.error('[CLEANUP] DB 레코드 삭제 실패:', deleteError)
      return NextResponse.json(
        {
          error: 'Failed to delete expired attachment records',
        },
        { status: 500 }
      )
    }

    console.log(`[CLEANUP] ${expiredAttachments.length}개의 임시 첨부파일 정리 완료`)

    // 4. 통계 반환
    return NextResponse.json({
      message: 'Temporary attachments cleanup completed',
      cleaned: expiredAttachments.length,
      files: expiredAttachments.map(att => ({
        id: att.id,
        fileName: att.file_name,
      })),
    })
  } catch (error) {
    console.error('[CLEANUP] 임시 첨부파일 정리 중 오류 발생:', error)
    return NextResponse.json(
      {
        error: 'Internal server error during cleanup',
      },
      { status: 500 }
    )
  }
}

/**
 * 정리 상태 조회
 */
export async function GET(request: NextRequest) {
  try {
    // 간단한 인증
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CLEANUP_CRON_TOKEN

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    // 임시 첨부파일 통계 조회
    const { data: stats, error } = await supabaseAdmin
      .from('post_attachments')
      .select('expires_at, file_size')
      .eq('is_temporary', true)

    if (error) {
      return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 })
    }

    const now = new Date()
    const expired = stats?.filter(s => new Date(s.expires_at) < now) || []
    const active = stats?.filter(s => new Date(s.expires_at) >= now) || []

    const totalSize = stats?.reduce((sum, s) => sum + s.file_size, 0) || 0
    const expiredSize = expired.reduce((sum, s) => sum + s.file_size, 0)

    return NextResponse.json({
      total: stats?.length || 0,
      active: active.length,
      expired: expired.length,
      totalSize,
      expiredSize,
      expiredSizeMB: Math.round((expiredSize / 1024 / 1024) * 100) / 100,
    })
  } catch (error) {
    console.error('[CLEANUP] 통계 조회 중 오류:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
