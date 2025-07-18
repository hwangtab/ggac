'use client'

import { useState } from 'react'
import { FiEdit3, FiEye, FiInfo } from 'react-icons/fi'
import ReactMarkdown from 'react-markdown'

interface BioEditorProps {
  value: string
  error?: string
  onChange: (value: string) => void
}

const BioEditor: React.FC<BioEditorProps> = ({
  value,
  error,
  onChange
}) => {
  const [isPreview, setIsPreview] = useState(false)

  const markdownGuide = `
# 마크다운 가이드

## 제목
# 큰 제목 (H1)
## 중간 제목 (H2)  
### 작은 제목 (H3)

## 텍스트 스타일
**굵게** 또는 __굵게__
*기울임* 또는 _기울임_

## 목록
- 순서없는 목록
- 항목 2
  - 하위 항목

1. 순서있는 목록
2. 항목 2

## 링크
[링크 텍스트](http://example.com)

## 기타
---
수평선

> 인용문
> 여러 줄 인용문
  `

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <FiEdit3 className="w-5 h-5 text-primary-600 mr-3" />
          <h2 className="text-lg font-semibold text-gray-900">아티스트 소개</h2>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsPreview(false)}
            className={`px-3 py-1 text-sm rounded-md transition-colors duration-200 ${
              !isPreview 
                ? 'bg-primary-100 text-primary-700' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FiEdit3 className="w-4 h-4 mr-1 inline" />
            편집
          </button>
          <button
            type="button"
            onClick={() => setIsPreview(true)}
            className={`px-3 py-1 text-sm rounded-md transition-colors duration-200 ${
              isPreview 
                ? 'bg-primary-100 text-primary-700' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FiEye className="w-4 h-4 mr-1 inline" />
            미리보기
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* 에디터/미리보기 영역 */}
        <div className="lg:col-span-2">
          {!isPreview ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                아티스트 소개 * (마크다운 지원)
              </label>
              <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={15}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 font-mono text-sm ${
                  error 
                    ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                    : 'border-gray-300'
                }`}
                placeholder={`자신의 음악이나 예술 활동에 대해 자세히 소개해주세요.

마크다운 문법을 사용할 수 있습니다:

### 음악 스타일
- 장르 1
- 장르 2

### 주요 작품
- **작품명**: 설명

### 경력사항
...`}
              />
              {error && (
                <p className="mt-1 text-xs text-red-600">{error}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                마크다운 문법을 사용하여 풍부한 서식으로 작성할 수 있습니다. 
                우측의 가이드를 참고하세요.
              </p>
            </div>
          ) : (
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">미리보기</div>
              <div className="w-full min-h-[380px] p-4 border rounded-md bg-white shadow-sm">
                {value ? (
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown>{value}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-gray-400 italic">
                    아티스트 소개를 입력하면 여기에 미리보기가 표시됩니다.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 마크다운 가이드 */}
        <div className="lg:col-span-1">
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <div className="flex items-center mb-3">
              <FiInfo className="w-4 h-4 text-blue-600 mr-2" />
              <h3 className="text-sm font-medium text-blue-900">마크다운 가이드</h3>
            </div>
            <div className="text-xs text-blue-800 space-y-2">
              <div>
                <div className="font-medium">제목</div>
                <div className="font-mono bg-white px-2 py-1 rounded mt-1">
                  # 큰 제목<br />
                  ## 중간 제목<br />
                  ### 작은 제목
                </div>
              </div>
              
              <div>
                <div className="font-medium">텍스트 스타일</div>
                <div className="font-mono bg-white px-2 py-1 rounded mt-1">
                  **굵게**<br />
                  *기울임*
                </div>
              </div>
              
              <div>
                <div className="font-medium">목록</div>
                <div className="font-mono bg-white px-2 py-1 rounded mt-1">
                  - 순서없는 목록<br />
                  1. 순서있는 목록
                </div>
              </div>
              
              <div>
                <div className="font-medium">링크</div>
                <div className="font-mono bg-white px-2 py-1 rounded mt-1">
                  [텍스트](URL)
                </div>
              </div>
              
              <div>
                <div className="font-medium">구분선</div>
                <div className="font-mono bg-white px-2 py-1 rounded mt-1">
                  ---
                </div>
              </div>
              
              <div>
                <div className="font-medium">인용문</div>
                <div className="font-mono bg-white px-2 py-1 rounded mt-1">
                  &gt; 인용문 내용
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BioEditor