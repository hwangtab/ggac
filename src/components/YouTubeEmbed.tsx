'use client'

import React from 'react'

interface YouTubeEmbedProps {
  videoUrl: string
  title: string
}

const YouTubeEmbed: React.FC<YouTubeEmbedProps> = ({ videoUrl, title }) => {
  const getVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
    const match = url.match(regExp)
    return match && match[2].length === 11 ? match[2] : null
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

  return (
    <div className="rounded-2xl overflow-hidden">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        className="w-full aspect-video border-0"
      />
    </div>
  )
}

export default YouTubeEmbed
