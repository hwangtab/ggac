export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'

// 동적 라우트 PATCH 테스트용
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    console.log('동적 PATCH 요청 수신됨, ID:', resolvedParams.id)
    
    const body = await request.json()
    console.log('요청 데이터:', body)
    
    return NextResponse.json({
      success: true,
      message: `ID ${resolvedParams.id}에 대한 PATCH 요청 처리 완료`,
      memberId: resolvedParams.id,
      received: body,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('동적 PATCH 처리 중 에러:', error)
    return NextResponse.json(
      { error: 'PATCH 처리 실패' },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  return NextResponse.json({
    message: `ID ${resolvedParams.id}에 대한 GET 요청 성공`,
    memberId: resolvedParams.id,
    supportedMethods: ['GET', 'PATCH'],
    timestamp: new Date().toISOString()
  })
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}