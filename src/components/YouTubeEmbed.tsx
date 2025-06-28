'use client'

import React, { useState } from 'react'
import { FiPlay, FiExternalLink } from 'react-icons/fi'

interface YouTubeEmbedProps {
  videoUrl: string
  title: string
}

const YouTubeEmbed: React.FC<YouTubeEmbedProps> = ({ videoUrl, title }) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const getVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
    const match = url.match(regExp)
    return match && match[2].length === 11 ? match[2] : null
  }

  const getThumbnailUrl = (videoId: string) => {
    return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
  }

  const videoId = getVideoId(videoUrl)

  if (!videoId) {
    return (
      <div className="w-full aspect-video rounded-2xl bg-gradient-to-br from-red-50 to-red-100 border border-red-200 flex items-center justify-center">
        <div className="text-red-600 text-center">
          <div className="text-lg font-medium mb-1">영상을 불러올 수 없습니다</div>
          <div className="text-sm opacity-70">올바른 YouTube URL인지 확인해주세요</div>
        </div>
      </div>
    )
  }

  const thumbnailUrl = getThumbnailUrl(videoId)

  return (
    <div 
      className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-800 to-black shadow-2xl transition-all duration-500 hover:shadow-3xl hover:scale-[1.02]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 제목 오버레이 */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 via-black/40 to-transparent p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-white font-medium text-sm md:text-base leading-tight line-clamp-2 flex-1">
            {title}
          </h3>
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 p-2 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-all duration-200 group/link"
            aria-label="YouTube에서 보기"
          >
            <FiExternalLink className="w-4 h-4 group-hover/link:scale-110 transition-transform duration-200" />
          </a>
        </div>
      </div>

      {/* 비디오 영역 */}
      <div className="relative w-full aspect-video bg-black">
        {!isLoaded ? (
          // 썸네일과 플레이 버튼
          <div className="relative w-full h-full cursor-pointer" onClick={() => setIsLoaded(true)}>
            <img
              src={thumbnailUrl}
              alt={title}
              className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105"
              onError={(e) => {
                // 썸네일 로드 실패 시 기본 썸네일 사용
                const target = e.target as HTMLImageElement
                target.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
              }}
            />
            
            {/* 그라데이션 오버레이 */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            
            {/* 플레이 버튼 */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={`
                relative flex items-center justify-center w-16 h-16 md:w-20 md:h-20
                bg-white/90 backdrop-blur-sm rounded-full shadow-2xl
                transition-all duration-300 group-hover:scale-110 group-hover:bg-white
                ${isHovered ? 'animate-pulse' : ''}
              `}>
                <FiPlay className="w-6 h-6 md:w-8 md:h-8 text-red-600 ml-1" />
                
                {/* 링 애니메이션 */}
                <div className="absolute inset-0 rounded-full border-2 border-white/50 animate-ping group-hover:border-red-200" />
              </div>
            </div>

            {/* YouTube 로고 */}
            <div className="absolute bottom-4 right-4">
              <div className="bg-red-600 text-white px-2 py-1 rounded text-xs font-bold tracking-wide">
                YouTube
              </div>
            </div>
          </div>
        ) : (
          // 실제 iframe
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="w-full h-full border-0"
          />
        )}
      </div>

      {/* 하단 정보 바 */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4">
        <div className="flex items-center justify-between text-white/80 text-xs">
          <span>YouTube 영상</span>
          <span className="opacity-60">클릭하여 재생</span>
        </div>
      </div>
    </div>
  )
}

export default YouTubeEmbed