'use client'

import { useState } from 'react'
import { FiDownload, FiCalendar, FiBarChart, FiUsers, FiFileText, FiFilter } from 'react-icons/fi'

interface ReportGeneratorProps {
  onReportGenerated?: (report: any) => void
}

export default function ReportGenerator({ onReportGenerated }: ReportGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [reportType, setReportType] = useState('comprehensive')
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  })
  const [filters, setFilters] = useState({
    includeInactive: false,
    minimumActivity: 0,
    categories: [] as string[],
  })
  const [generatedReport, setGeneratedReport] = useState<any>(null)

  const reportTypes = [
    {
      id: 'comprehensive',
      name: '종합 리포트',
      description: '모든 지표를 포함한 전체 시스템 분석',
      icon: FiBarChart,
      color: 'blue',
    },
    {
      id: 'member_activity',
      name: '멤버 활동 리포트',
      description: '사용자 활동 패턴 및 참여도 분석',
      icon: FiUsers,
      color: 'green',
    },
    {
      id: 'post_engagement',
      name: '게시글 참여도 리포트',
      description: '게시글 조회, 댓글, 좋아요 등 참여도 분석',
      icon: FiFileText,
      color: 'purple',
    },
    {
      id: 'user_registration',
      name: '신규 가입 리포트',
      description: '회원 가입 현황 및 승인 상태 분석',
      icon: FiUsers,
      color: 'orange',
    },
  ]

  const handleGenerateReport = async () => {
    if (isGenerating) return

    setIsGenerating(true)
    try {
      const response = await fetch('/api/admin/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType,
          dateRange,
          filters,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        setGeneratedReport(data.report)
        onReportGenerated?.(data.report)
      } else {
        throw new Error(data.error || '리포트 생성에 실패했습니다.')
      }
    } catch (error) {
      console.error('Report generation error:', error)
      alert('리포트 생성 중 오류가 발생했습니다.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownloadReport = () => {
    if (!generatedReport) return

    const dataStr = JSON.stringify(generatedReport, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)

    const link = document.createElement('a')
    link.href = url
    link.download = `report_${generatedReport.metadata.type}_${generatedReport.metadata.generatedAt.split('T')[0]}.json`
    link.click()

    URL.revokeObjectURL(url)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ko-KR')
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ko-KR').format(num)
  }

  return (
    <div className="space-y-6">
      {/* 리포트 설정 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center mb-6">
          <FiBarChart className="w-6 h-6 text-blue-600 mr-3" />
          <h2 className="text-xl font-semibold text-gray-900">리포트 생성</h2>
        </div>

        {/* 리포트 유형 선택 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">리포트 유형</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reportTypes.map(type => {
              const IconComponent = type.icon
              return (
                <div
                  key={type.id}
                  className={`relative border-2 rounded-lg p-4 cursor-pointer transition-all ${
                    reportType === type.id
                      ? `border-${type.color}-500 bg-${type.color}-50`
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setReportType(type.id)}
                >
                  <div className="flex items-start">
                    <IconComponent
                      className={`w-5 h-5 mt-1 mr-3 ${
                        reportType === type.id ? `text-${type.color}-600` : 'text-gray-600'
                      }`}
                    />
                    <div>
                      <h3
                        className={`font-medium ${
                          reportType === type.id ? `text-${type.color}-900` : 'text-gray-900'
                        }`}
                      >
                        {type.name}
                      </h3>
                      <p
                        className={`text-sm mt-1 ${
                          reportType === type.id ? `text-${type.color}-700` : 'text-gray-600'
                        }`}
                      >
                        {type.description}
                      </p>
                    </div>
                  </div>
                  {reportType === type.id && (
                    <div
                      className={`absolute top-2 right-2 w-4 h-4 bg-${type.color}-600 rounded-full flex items-center justify-center`}
                    >
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 날짜 범위 선택 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            <FiCalendar className="w-4 h-4 inline mr-2" />
            분석 기간
          </label>
          <div className="flex flex-col sm:flex-row gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">시작일</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">종료일</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={e => setDateRange({ ...dateRange, end: e.target.value })}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* 필터 옵션 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            <FiFilter className="w-4 h-4 inline mr-2" />
            필터 옵션
          </label>
          <div className="space-y-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filters.includeInactive}
                onChange={e => setFilters({ ...filters, includeInactive: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-600">비활성 사용자 포함</span>
            </label>
            <div>
              <label className="block text-sm text-gray-600 mb-1">최소 활동 수 (필터링 기준)</label>
              <input
                type="number"
                min="0"
                value={filters.minimumActivity}
                onChange={e =>
                  setFilters({ ...filters, minimumActivity: parseInt(e.target.value) || 0 })
                }
                className="block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* 생성 버튼 */}
        <button
          onClick={handleGenerateReport}
          disabled={isGenerating}
          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-6 rounded-lg transition-colors"
        >
          {isGenerating ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              리포트 생성 중...
            </div>
          ) : (
            <div className="flex items-center">
              <FiBarChart className="w-4 h-4 mr-2" />
              리포트 생성
            </div>
          )}
        </button>
      </div>

      {/* 생성된 리포트 미리보기 */}
      {generatedReport && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">생성된 리포트</h3>
            <button
              onClick={handleDownloadReport}
              className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center"
            >
              <FiDownload className="w-4 h-4 mr-2" />
              다운로드
            </button>
          </div>

          {/* 리포트 메타데이터 */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">리포트 유형:</span>
                <span className="ml-2 text-gray-600">
                  {reportTypes.find(t => t.id === generatedReport.metadata.type)?.name}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-700">생성 시간:</span>
                <span className="ml-2 text-gray-600">
                  {formatDate(generatedReport.metadata.generatedAt)}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-700">분석 기간:</span>
                <span className="ml-2 text-gray-600">
                  {formatDate(generatedReport.metadata.dateRange.start)} ~{' '}
                  {formatDate(generatedReport.metadata.dateRange.end)}
                </span>
              </div>
            </div>
          </div>

          {/* 주요 지표 요약 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {generatedReport.metadata.summary &&
              Object.entries(generatedReport.metadata.summary).map(
                ([key, value]: [string, any]) => {
                  // 한국어 키를 그대로 표시하고, 영어 키는 한국어로 변환
                  const getKoreanLabel = (key: string) => {
                    const keyMap: { [key: string]: string } = {
                      // 기존 영어 키들 (하위 호환성을 위해)
                      totalActivities: '총활동수',
                      uniqueUsers: '순사용자수',
                      totalMembers: '총회원수',
                      approvedMembers: '승인회원수',
                      pendingMembers: '대기회원수',
                      activeMembers: '활성회원수',
                      totalPosts: '총게시글수',
                      totalComments: '총댓글수',
                      totalViews: '총조회수',
                      totalLikes: '총좋아요수',
                      averageEngagement: '평균참여도',
                      totalRegistrations: '총신규등록수',
                      approvedCount: '승인수',
                      pendingCount: '대기수',
                      rejectedCount: '거부수',
                      artistCount: '아티스트수',
                      topActivity: '주요활동',
                      averageActivitiesPerUser: '사용자당평균활동수',
                    }
                    // 이미 한국어면 그대로 반환, 영어면 변환
                    return keyMap[key] || key
                  }

                  return (
                    <div key={key} className="bg-blue-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {typeof value === 'number' ? formatNumber(value) : String(value)}
                      </div>
                      <div className="text-sm text-blue-700">{getKoreanLabel(key)}</div>
                    </div>
                  )
                }
              )}
          </div>

          {/* 상세 데이터 표시는 별도 컴포넌트로 분리 예정 */}
          <div className="text-sm text-gray-500 text-center py-4 border-t border-gray-200">
            상세 분석 결과는 다운로드한 파일에서 확인하실 수 있습니다.
          </div>
        </div>
      )}
    </div>
  )
}
