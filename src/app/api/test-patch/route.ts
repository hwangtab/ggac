import { NextRequest, NextResponse } from 'next/server'

// 단순한 PATCH 테스트용 라우트
export async function PATCH(request: NextRequest) {
  try {
    console.log('PATCH 요청 수신됨')
    
    const body = await request.json()
    console.log('요청 데이터:', body)
    
    return NextResponse.json({
      success: true,
      message: 'PATCH 요청이 정상적으로 처리됨',
      received: body,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('PATCH 처리 중 에러:', error)
    return NextResponse.json(
      { error: 'PATCH 처리 실패' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'GET 요청 성공 - PATCH도 지원됩니다',
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