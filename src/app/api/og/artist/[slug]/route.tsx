import { ImageResponse } from 'next/og'
import fs from 'fs'
import path from 'path'
import type { Artist } from '@/types'

export const dynamic = 'force-dynamic'

// 이미지를 base64로 변환하는 함수
async function getImageAsBase64(imagePath: string): Promise<string | null> {
  try {
    const fullPath = path.join(process.cwd(), 'public', imagePath)
    
    // WebP 대신 JPG/PNG 파일이 있는지 확인
    const extWithoutWebp = imagePath.replace('.webp', '.jpg')
    const jpgPath = path.join(process.cwd(), 'public', extWithoutWebp)
    const pngPath = path.join(process.cwd(), 'public', imagePath.replace('.webp', '.png'))
    
    let actualPath = fullPath
    let mimeType = 'image/webp'
    
    // JPG 파일이 있으면 우선 사용
    if (fs.existsSync(jpgPath)) {
      actualPath = jpgPath
      mimeType = 'image/jpeg'
    } else if (fs.existsSync(pngPath)) {
      actualPath = pngPath
      mimeType = 'image/png'
    } else if (!fs.existsSync(fullPath)) {
      return null
    }
    
    const imageBuffer = fs.readFileSync(actualPath)
    const base64 = imageBuffer.toString('base64')
    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.error('Error converting image to base64:', error)
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: { slug: string } }
) {
  try {
    // Node.js runtime에서 fs 사용 가능
    const artistsData = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
    ) as Artist[]
    
    const artist = artistsData.find(a => a.slug === params.slug)

    if (!artist) {
      return new Response('Artist not found', { status: 404 })
    }

    // 이미지를 base64로 변환
    const imageBase64 = await getImageAsBase64(artist.profileImage)

    // 아티스트 이름 길이에 따른 폰트 크기 조정
    const getNameFontSize = (name: string) => {
      if (name.length > 15) return '48px'
      if (name.length > 10) return '56px'
      return '64px'
    }

    // 한줄 소개 길이 제한
    const truncateOneLiner = (text: string, maxLength: number = 80) => {
      if (text.length <= maxLength) return text
      return text.substring(0, maxLength) + '...'
    }

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f8fafc',
            backgroundImage: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 50%, #f3850b 100%)',
          }}
        >
          {/* 배경 패턴 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundImage: 'radial-gradient(circle at 20% 50%, #ffffff15 1px, transparent 1px), radial-gradient(circle at 80% 50%, #ffffff15 1px, transparent 1px)',
              backgroundSize: '80px 80px',
              opacity: 0.6,
            }}
          />
          
          {/* 추가 그라데이션 오버레이 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(45deg, #0ea5e940 0%, transparent 50%, #f3850b40 100%)',
            }}
          />
          
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              height: '100%',
              padding: '80px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {/* 왼쪽: 아티스트 정보 */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'center',
                flex: 1,
                paddingRight: '60px',
              }}
            >
              {/* 카테고리 태그 */}
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  marginBottom: '24px',
                  flexWrap: 'wrap',
                  maxWidth: '600px',
                }}
              >
                {Array.isArray(artist.category) ? (
                  artist.category.slice(0, 3).map((cat, index) => (
                    <span
                      key={index}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ffffff25',
                        borderRadius: '20px',
                        color: '#ffffff',
                        fontSize: '18px',
                        fontWeight: '500',
                        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                        wordBreak: 'keep-all',
                        whiteSpace: 'nowrap',
                        border: '1px solid #ffffff20',
                      }}
                    >
                      {cat}
                    </span>
                  ))
                ) : (
                  <span
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#ffffff25',
                      borderRadius: '20px',
                      color: '#ffffff',
                      fontSize: '18px',
                      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                      fontWeight: '500',
                      wordBreak: 'keep-all',
                      whiteSpace: 'nowrap',
                      border: '1px solid #ffffff20',
                    }}
                  >
                    {artist.category}
                  </span>
                )}
              </div>

              {/* 아티스트 이름 */}
              <h1
                style={{
                  fontSize: getNameFontSize(artist.name),
                  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                  fontWeight: '700',
                  color: '#ffffff',
                  marginBottom: '20px',
                  lineHeight: 1.1,
                  wordBreak: 'keep-all',
                  overflowWrap: 'break-word',
                  maxWidth: '600px',
                  textShadow: '0 4px 8px rgba(0, 0, 0, 0.4)',
                }}
              >
                {artist.name}
              </h1>

              {/* 한줄 소개 */}
              <p
                style={{
                  fontSize: '24px',
                  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                  fontWeight: '400',
                  color: '#ffffff',
                  lineHeight: 1.4,
                  maxWidth: '600px',
                  wordBreak: 'keep-all',
                  overflowWrap: 'break-word',
                  whiteSpace: 'pre-wrap',
                  textShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
                  opacity: 0.95,
                }}
              >
                {truncateOneLiner(artist.oneLiner)}
              </p>

              {/* 경기아트콜렉티브 로고/텍스트 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: '40px',
                  padding: '16px 24px',
                  backgroundColor: '#ffffff20',
                  borderRadius: '12px',
                  border: '1px solid #ffffff25',
                  boxShadow: '0 8px 16px rgba(0, 0, 0, 0.2)',
                }}
              >
                <span
                  style={{
                    fontSize: '20px',
                    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                    fontWeight: '600',
                    color: '#ffffff',
                    wordBreak: 'keep-all',
                    whiteSpace: 'nowrap',
                    textShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  경기아트콜렉티브
                </span>
              </div>
            </div>

            {/* 오른쪽: 프로필 이미지 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: '300px',
                  height: '300px',
                  borderRadius: '50%',
                  border: '4px solid #ffffff40',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#ffffff15',
                  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
                }}
              >
                {imageBase64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageBase64}
                    alt={artist.name}
                    width={300}
                    height={300}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      fontSize: '80px',
                      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                      fontWeight: '700',
                      color: '#ffffff',
                    }}
                  >
                    {artist.name.slice(0, 2)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    )
  } catch (error) {
    console.error('Error generating OG image:', error)
    return new Response('Failed to generate image', { status: 500 })
  }
}
