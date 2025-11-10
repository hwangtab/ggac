'use client'

import { FiYoutube, FiPlus, FiTrash2, FiPlay, FiExternalLink } from 'react-icons/fi'
import { YouTubeVideo } from '@/types'

interface YoutubeVideosProps {
  videos: YouTubeVideo[]
  errors: Record<string, string>
  onChange: (videos: YouTubeVideo[]) => void
}

const YoutubeVideos: React.FC<YoutubeVideosProps> = ({ videos, errors, onChange }) => {
  const addVideo = () => {
    onChange([...videos, { title: '', url: '' }])
  }

  const removeVideo = (index: number) => {
    onChange(videos.filter((_, i) => i !== index))
  }

  const updateVideo = (index: number, field: 'title' | 'url', value: string) => {
    const updatedVideos = videos.map((video, i) =>
      i === index ? { ...video, [field]: value } : video
    )
    onChange(updatedVideos)
  }

  // YouTube URL에서 비디오 ID 추출
  const getYouTubeVideoId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
    const match = url.match(regExp)
    return match && match[2].length === 11 ? match[2] : null
  }

  // YouTube 썸네일 URL 생성
  const getYouTubeThumbnail = (url: string): string | null => {
    const videoId = getYouTubeVideoId(url)
    return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null
  }

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <FiYoutube className="w-5 h-5 text-red-600 mr-3" />
          <h2 className="text-lg font-semibold text-gray-900">유튜브 동영상</h2>
        </div>

        <button
          type="button"
          onClick={addVideo}
          className="flex items-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors duration-200"
        >
          <FiPlus className="w-4 h-4 mr-1" />
          동영상 추가
        </button>
      </div>

      <div className="space-y-4">
        {videos.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
            <FiYoutube className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500 text-sm mb-3">유튜브 동영상을 추가해보세요</p>
            <p className="text-gray-400 text-xs mb-4">
              공연 영상, 작품 소개, 인터뷰 등을 공유할 수 있습니다
            </p>
            <button
              type="button"
              onClick={addVideo}
              className="tw-btn-primary bg-red-600 hover:bg-red-700"
            >
              <FiPlus className="w-4 h-4 mr-1" />첫 번째 동영상 추가
            </button>
          </div>
        ) : (
          videos.map((video, index) => {
            const thumbnailUrl = getYouTubeThumbnail(video.url)

            return (
              <div key={index} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="text-sm font-medium text-gray-700">동영상 #{index + 1}</div>
                  <button
                    type="button"
                    onClick={() => removeVideo(index)}
                    className="text-gray-400 hover:text-red-500 transition-colors duration-200"
                  >
                    <FiTrash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* 동영상 미리보기 */}
                  <div className="lg:col-span-1">
                    {thumbnailUrl ? (
                      <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailUrl}
                          alt={video.title || '유튜브 동영상'}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center">
                          <FiPlay className="w-8 h-8 text-white" />
                        </div>
                        {video.url && (
                          <a
                            href={video.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="absolute top-2 right-2 p-1 bg-black bg-opacity-50 text-white rounded hover:bg-opacity-70"
                          >
                            <FiExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
                        <FiYoutube className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* 동영상 정보 */}
                  <div className="lg:col-span-2 space-y-4">
                    {/* 동영상 제목 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        동영상 제목
                      </label>
                      <input
                        type="text"
                        value={video.title}
                        onChange={e => updateVideo(index, 'title', e.target.value)}
                        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
                          errors[`youtube_${index}_title`]
                            ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                            : 'border-gray-300'
                        }`}
                        placeholder="동영상 제목을 입력하세요"
                      />
                      {errors[`youtube_${index}_title`] && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors[`youtube_${index}_title`]}
                        </p>
                      )}
                    </div>

                    {/* 유튜브 URL */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        유튜브 URL
                      </label>
                      <input
                        type="url"
                        value={video.url}
                        onChange={e => updateVideo(index, 'url', e.target.value)}
                        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
                          errors[`youtube_${index}_url`]
                            ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                            : 'border-gray-300'
                        }`}
                        placeholder="https://www.youtube.com/watch?v=..."
                      />
                      {errors[`youtube_${index}_url`] && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors[`youtube_${index}_url`]}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        youtube.com 또는 youtu.be 링크를 입력하세요
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* URL 형식 가이드 */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="text-sm font-medium text-blue-900 mb-3">유튜브 URL 형식 안내</h4>
        <div className="text-xs text-blue-800 space-y-2">
          <div>
            <div className="font-medium">일반 링크:</div>
            <div className="font-mono bg-white px-2 py-1 rounded mt-1">
              https://www.youtube.com/watch?v=VIDEO_ID
            </div>
          </div>
          <div>
            <div className="font-medium">단축 링크:</div>
            <div className="font-mono bg-white px-2 py-1 rounded mt-1">
              https://youtu.be/VIDEO_ID
            </div>
          </div>
          <div>
            <div className="font-medium">임베드 링크:</div>
            <div className="font-mono bg-white px-2 py-1 rounded mt-1">
              https://www.youtube.com/embed/VIDEO_ID
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        💡 팁: 동영상은 아티스트 프로필 페이지에서 임베드 형태로 표시되어 바로 재생할 수 있습니다.
      </p>
    </div>
  )
}

export default YoutubeVideos
