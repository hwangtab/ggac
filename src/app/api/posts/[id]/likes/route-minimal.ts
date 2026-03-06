/**
 * 최소한의 API 라우트 테스트
 * 복잡한 로직 없이 기본 동작만 확인
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  console.log('🟢 [MINIMAL] API 라우트 실행 성공!')

  const resolvedParams = await context.params
  const postId = resolvedParams.id

  console.log('🟢 [MINIMAL] Post ID:', postId)

  return NextResponse.json({
    success: true,
    postId,
    message: 'Minimal API route working',
    timestamp: new Date().toISOString(),
  })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  console.log('🟢 [MINIMAL] GET 라우트 실행 성공!')

  const resolvedParams = await context.params
  const postId = resolvedParams.id

  return NextResponse.json({
    method: 'GET',
    postId,
    message: 'Minimal GET route working',
    timestamp: new Date().toISOString(),
  })
}
