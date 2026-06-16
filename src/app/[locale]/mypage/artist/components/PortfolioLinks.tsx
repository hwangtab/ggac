'use client'

import { FiLink, FiPlus, FiTrash2, FiExternalLink } from 'react-icons/fi'
import { PortfolioLink } from '@/types'
import { toSafeHttpUrl } from '@/utils/safeUrl'

interface PortfolioLinksProps {
  links: PortfolioLink[]
  errors: Record<string, string>
  onChange: (links: PortfolioLink[]) => void
}

const PortfolioLinks: React.FC<PortfolioLinksProps> = ({ links, errors, onChange }) => {
  const addLink = () => {
    onChange([...links, { title: '', url: '' }])
  }

  const removeLink = (index: number) => {
    onChange(links.filter((_, i) => i !== index))
  }

  const updateLink = (index: number, field: 'title' | 'url', value: string) => {
    const updatedLinks = links.map((link, i) => (i === index ? { ...link, [field]: value } : link))
    onChange(updatedLinks)
  }

  const platformSuggestions = [
    { name: 'Instagram', placeholder: 'https://instagram.com/username' },
    { name: 'YouTube', placeholder: 'https://youtube.com/@channel' },
    { name: 'Bandcamp', placeholder: 'https://username.bandcamp.com' },
    { name: 'SoundCloud', placeholder: 'https://soundcloud.com/username' },
    { name: 'Spotify', placeholder: 'https://open.spotify.com/artist/...' },
    { name: 'Apple Music', placeholder: 'https://music.apple.com/artist/...' },
    { name: 'Twitter/X', placeholder: 'https://twitter.com/username' },
    { name: 'Facebook', placeholder: 'https://facebook.com/page' },
    { name: 'TikTok', placeholder: 'https://tiktok.com/@username' },
    { name: 'Website', placeholder: 'https://yourwebsite.com' },
  ]

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <FiLink className="w-5 h-5 text-primary-600 mr-3" />
          <h2 className="text-lg font-semibold text-gray-900">포트폴리오 링크</h2>
        </div>

        <button
          type="button"
          onClick={addLink}
          className="flex items-center px-3 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-md hover:bg-primary-100 transition-colors duration-200"
        >
          <FiPlus className="w-4 h-4 mr-1" />
          링크 추가
        </button>
      </div>

      <div className="space-y-4">
        {links.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
            <FiLink className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500 text-sm mb-3">포트폴리오 링크를 추가해보세요</p>
            <p className="text-gray-400 text-xs mb-4">
              SNS, 스트리밍 플랫폼, 개인 웹사이트 등을 연결할 수 있습니다
            </p>
            <button type="button" onClick={addLink} className="tw-btn-primary">
              <FiPlus className="w-4 h-4 mr-1" />첫 번째 링크 추가
            </button>
          </div>
        ) : (
          links.map((link, index) => {
            const safeUrl = toSafeHttpUrl(link.url)

            return (
              <div
                key={`${link.url || 'new'}-${index}`}
                className="bg-white border border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-sm font-medium text-gray-700">링크 #{index + 1}</div>
                  <button
                    type="button"
                    onClick={() => removeLink(index)}
                    className="text-gray-400 hover:text-red-500 transition-colors duration-200"
                  >
                    <FiTrash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 링크 제목 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      링크 제목
                    </label>
                    <input
                      type="text"
                      value={link.title}
                      onChange={e => updateLink(index, 'title', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
                        errors[`portfolio_${index}_title`]
                          ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                          : 'border-gray-300'
                      }`}
                      placeholder="예: Instagram, YouTube, 개인 웹사이트"
                    />
                    {errors[`portfolio_${index}_title`] && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors[`portfolio_${index}_title`]}
                      </p>
                    )}
                  </div>

                  {/* 링크 URL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">링크 URL</label>
                    <div className="relative">
                      <input
                        type="url"
                        value={link.url}
                        onChange={e => updateLink(index, 'url', e.target.value)}
                        className={`w-full px-3 py-2 pr-10 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
                          errors[`portfolio_${index}_url`]
                            ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                            : 'border-gray-300'
                        }`}
                        placeholder="https://..."
                      />
                      {safeUrl && (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-primary-600"
                        >
                          <FiExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                    {errors[`portfolio_${index}_url`] && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors[`portfolio_${index}_url`]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 플랫폼 제안 */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="text-sm font-medium text-blue-900 mb-3">추천 플랫폼</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {platformSuggestions.map(platform => (
            <button
              key={platform.name}
              type="button"
              onClick={() => {
                const emptyIndex = links.findIndex(link => !link.title && !link.url)
                if (emptyIndex !== -1) {
                  updateLink(emptyIndex, 'title', platform.name)
                } else {
                  onChange([...links, { title: platform.name, url: '' }])
                }
              }}
              className="text-left p-2 text-blue-800 bg-white rounded border border-blue-200 hover:bg-blue-50 transition-colors duration-200"
            >
              <div className="font-medium">{platform.name}</div>
              <div className="text-blue-600 truncate">{platform.placeholder}</div>
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        💡 팁: 링크는 아티스트 프로필 페이지에서 방문자들이 쉽게 접근할 수 있도록 표시됩니다.
      </p>
    </div>
  )
}

export default PortfolioLinks
