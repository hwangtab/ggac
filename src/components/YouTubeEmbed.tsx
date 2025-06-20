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
    return <div className="text-red-500">Invalid YouTube URL</div>
  }

  return (
    <div className="w-full rounded-xl overflow-hidden shadow-xl bg-white">
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-lg font-medium text-gray-900 font-sans tracking-tight mb-2 flex items-center min-w-0 before:content-['▷'] before:text-red-600 before:mr-2 before:text-base before:font-bold before:drop-shadow-sm">
          <span className="whitespace-nowrap overflow-hidden text-ellipsis">
            {title}
          </span>
        </h3>
      </div>
      <div className="w-full aspect-video bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </div>
    </div>
  )
}

export default YouTubeEmbed