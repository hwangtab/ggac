/**
 * 이미지 프록시 API
 * 외부 이미지 URL을 안전하게 프록시하여 제공
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateImageUrl } from '@/utils/imageValidation';
import { applyRateLimit, RATE_LIMIT_CONFIGS, createIPKeyGenerator, addRateLimitHeaders } from '@/utils/rateLimiter';
import { logSecurityEvent } from '@/utils/security';

// 이미지 캐시 (간단한 메모리 캐시)
const imageCache = new Map<string, { data: Buffer; headers: Record<string, string>; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1시간

export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createIPKeyGenerator('image_proxy')
    });
    
    const rateLimitResult = rateLimiter(request);
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response;
    }

    // URL 파라미터 추출
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');
    
    if (!imageUrl) {
      return NextResponse.json({ error: '이미지 URL이 필요합니다.' }, { status: 400 });
    }

    // 이미지 URL 검증
    const validation = await validateImageUrl(imageUrl);
    if (!validation.isValid) {
      logSecurityEvent('BLOCKED_IMAGE_PROXY_REQUEST', {
        url: imageUrl,
        errors: validation.errors
      }, 'medium');
      
      return NextResponse.json({ 
        error: '허용되지 않은 이미지 URL입니다.',
        details: validation.errors 
      }, { status: 403 });
    }

    // 캐시 확인
    const cacheKey = generateCacheKey(imageUrl);
    const cached = imageCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      const response = new NextResponse(new Uint8Array(cached.data), { 
        status: 200,
        headers: {
          ...cached.headers,
          'X-Cache': 'HIT'
        }
      });
      
      return addRateLimitHeaders(
        response,
        RATE_LIMIT_CONFIGS.GENERAL_API.maxRequests,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      );
    }

    // 외부 이미지 요청
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃

    try {
      const imageResponse = await fetch(validation.sanitizedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'GGAC-ImageProxy/1.0',
          'Accept': 'image/*',
          'Cache-Control': 'no-cache'
        }
      });

      clearTimeout(timeoutId);

      if (!imageResponse.ok) {
        throw new Error(`HTTP ${imageResponse.status}`);
      }

      // Content-Type 검증
      const contentType = imageResponse.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('응답이 이미지 형식이 아닙니다.');
      }

      // 파일 크기 검증
      const contentLength = imageResponse.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10MB 제한
        throw new Error('이미지 파일이 너무 큽니다.');
      }

      // 이미지 데이터 읽기
      const imageBuffer = await imageResponse.arrayBuffer();
      const imageData = Buffer.from(imageBuffer);

      // 이미지 시그니처 검증
      if (!isValidImageSignature(imageData)) {
        throw new Error('유효하지 않은 이미지 파일입니다.');
      }

      // 응답 헤더 설정
      const responseHeaders = {
        'Content-Type': contentType,
        'Content-Length': imageData.length.toString(),
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'MISS',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      };

      // 캐시 저장
      imageCache.set(cacheKey, {
        data: imageData,
        headers: responseHeaders,
        timestamp: Date.now()
      });

      // 오래된 캐시 정리
      cleanupCache();

      const response = new NextResponse(new Uint8Array(imageData), {
        status: 200,
        headers: responseHeaders
      });

      return addRateLimitHeaders(
        response,
        RATE_LIMIT_CONFIGS.GENERAL_API.maxRequests,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      );

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      logSecurityEvent('IMAGE_PROXY_FETCH_ERROR', {
        url: imageUrl,
        error: fetchError instanceof Error ? fetchError.message : 'Unknown error'
      }, 'medium');

      return NextResponse.json({ 
        error: '이미지를 불러올 수 없습니다.',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown error'
      }, { status: 502 });
    }

  } catch (error) {
    console.error('Image proxy API error:', error);
    logSecurityEvent('IMAGE_PROXY_ERROR', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 'high');
    
    return NextResponse.json({ 
      error: '이미지 프록시 처리 중 오류가 발생했습니다.' 
    }, { status: 500 });
  }
}

/**
 * 캐시 키 생성
 */
function generateCacheKey(url: string): string {
  return Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
}

/**
 * 이미지 시그니처 검증
 */
function isValidImageSignature(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;

  const signatures = [
    // JPEG
    [0xFF, 0xD8, 0xFF],
    // PNG
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    // GIF
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    // WebP
    [0x52, 0x49, 0x46, 0x46], // RIFF header
    // BMP
    [0x42, 0x4D],
    // ICO
    [0x00, 0x00, 0x01, 0x00],
    // TIFF
    [0x49, 0x49, 0x2A, 0x00],
    [0x4D, 0x4D, 0x00, 0x2A]
  ];

  return signatures.some(signature => {
    if (buffer.length < signature.length) return false;
    return signature.every((byte, index) => buffer[index] === byte);
  });
}

/**
 * 캐시 정리
 */
function cleanupCache(): void {
  const now = Date.now();
  const entries = Array.from(imageCache.entries());
  for (const [key, value] of entries) {
    if (now - value.timestamp > CACHE_DURATION) {
      imageCache.delete(key);
    }
  }
}

// OPTIONS 요청 처리
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}