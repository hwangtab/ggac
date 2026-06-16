import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const publicPath = path.resolve(process.cwd(), 'public')
const transparentPixel = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)
const imageMimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

function resolvePublicImagePath(imagePath: string) {
  const cleanPath = imagePath.trim().replace(/^\/+/, '')
  if (!cleanPath || cleanPath.includes('\0')) return null

  const resolved = path.resolve(publicPath, cleanPath)
  const relativePath = path.relative(publicPath, resolved)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null

  const ext = path.extname(resolved).toLowerCase()
  const contentType = imageMimeTypes[ext]
  if (!contentType) return null

  return { cleanPath: relativePath, resolved, contentType }
}

function notFoundPixelResponse() {
  return new NextResponse(transparentPixel, {
    status: 404,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const imagePath = searchParams.get('path')
    const format = searchParams.get('format') || 'jpg'

    if (!imagePath) {
      return createErrorResponse({ success: false, error: 'Image path is required' }, 400)
    }

    const imageTarget = resolvePublicImagePath(imagePath)
    if (!imageTarget) {
      return new NextResponse(null, { status: 403 })
    }

    // WebP를 JPG로 변환하는 경우
    if (imageTarget.cleanPath.toLowerCase().endsWith('.webp') && format === 'jpg') {
      const jpgTarget = resolvePublicImagePath(imageTarget.cleanPath.replace(/\.webp$/i, '.jpg'))

      // JPG 파일이 이미 존재하는 경우
      if (
        jpgTarget &&
        fs.existsSync(jpgTarget.resolved) &&
        fs.statSync(jpgTarget.resolved).isFile()
      ) {
        const imageBuffer = fs.readFileSync(jpgTarget.resolved)

        return new NextResponse(imageBuffer, {
          status: 200,
          headers: {
            'Content-Type': jpgTarget.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Length': imageBuffer.length.toString(),
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }
    }

    // 파일 존재 확인
    if (!fs.existsSync(imageTarget.resolved) || !fs.statSync(imageTarget.resolved).isFile()) {
      console.error('Image not found:', imageTarget.resolved)
      return notFoundPixelResponse()
    }

    // 원본 이미지 반환
    const imageBuffer = fs.readFileSync(imageTarget.resolved)

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': imageTarget.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': imageBuffer.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Image API error:', error)

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

    const imageTarget = resolvePublicImagePath(imagePath)
    if (!imageTarget) {
      return new NextResponse(null, { status: 403 })
    }

    let target = imageTarget
    if (imageTarget.cleanPath.toLowerCase().endsWith('.webp') && format === 'jpg') {
      target =
        resolvePublicImagePath(imageTarget.cleanPath.replace(/\.webp$/i, '.jpg')) ?? imageTarget
    }

    if (!fs.existsSync(target.resolved) || !fs.statSync(target.resolved).isFile()) {
      return new NextResponse(null, { status: 404 })
    }

    const stats = fs.statSync(target.resolved)

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': target.contentType,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return new NextResponse(null, { status: 500 })
  }
}
