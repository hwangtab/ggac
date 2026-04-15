import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const imagePath = searchParams.get('path')
    const format = searchParams.get('format') || 'jpg'

    if (!imagePath) {
      return NextResponse.json({ error: 'Image path is required' }, { status: 400 })
    }

    // 보안을 위한 경로 정리
    const cleanPath = imagePath.replace(/^\/+/, '').replace(/\.\.+/g, '.')
    const publicPath = path.join(process.cwd(), 'public')

    // Path traversal defense: ensure resolved path stays within publicPath
    const resolved = path.resolve(publicPath, cleanPath)
    if (!resolved.startsWith(publicPath)) {
      return new NextResponse(null, { status: 403 })
    }

    // WebP를 JPG로 변환하는 경우
    if (cleanPath.toLowerCase().endsWith('.webp') && format === 'jpg') {
      const jpgPath = cleanPath.replace(/\.webp$/i, '.jpg')
      const jpgFullPath = path.join(publicPath, jpgPath)

      // JPG 파일이 이미 존재하는 경우
      if (fs.existsSync(jpgFullPath)) {
        const imageBuffer = fs.readFileSync(jpgFullPath)

        return new NextResponse(imageBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Length': imageBuffer.length.toString(),
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }
    }

    // 원본 파일 경로
    const fullImagePath = path.join(publicPath, cleanPath)

    // 파일 존재 확인
    if (!fs.existsSync(fullImagePath)) {
      console.error('Image not found:', fullImagePath)

      // 대체 이미지 반환 (투명 1x1 픽셀)
      const transparentPixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      )

      return new NextResponse(transparentPixel, {
        status: 404,
        headers: {
          'Content-Type': 'image/gif',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    // 원본 이미지 반환
    const imageBuffer = fs.readFileSync(fullImagePath)
    const ext = path.extname(cleanPath).toLowerCase()

    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    }

    const contentType = mimeTypes[ext] || 'application/octet-stream'

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': imageBuffer.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Image API error:', error)

    // 에러 시 투명 픽셀 반환
    const transparentPixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    )

    return new NextResponse(transparentPixel, {
      status: 500,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
}

// HEAD 요청 지원 (SNS 크롤러용)
export async function HEAD(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const imagePath = searchParams.get('path')
    const format = searchParams.get('format') || 'jpg'

    if (!imagePath) {
      return new NextResponse(null, { status: 400 })
    }

    const cleanPath = imagePath.replace(/^\/+/, '').replace(/\.\.+/g, '.')
    const publicPath = path.join(process.cwd(), 'public')

    // Path traversal defense
    const resolvedHead = path.resolve(publicPath, cleanPath)
    if (!resolvedHead.startsWith(publicPath)) {
      return new NextResponse(null, { status: 403 })
    }

    let targetPath = cleanPath
    if (cleanPath.toLowerCase().endsWith('.webp') && format === 'jpg') {
      targetPath = cleanPath.replace(/\.webp$/i, '.jpg')
    }

    const fullImagePath = path.join(publicPath, targetPath)

    if (!fs.existsSync(fullImagePath)) {
      return new NextResponse(null, { status: 404 })
    }

    const stats = fs.statSync(fullImagePath)
    const ext = path.extname(targetPath).toLowerCase()

    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    }

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': mimeTypes[ext] || 'image/jpeg',
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    return new NextResponse(null, { status: 500 })
  }
}
