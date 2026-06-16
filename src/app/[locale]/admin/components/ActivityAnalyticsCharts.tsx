'use client'

import { useState, useEffect, useCallback } from 'react'
import { FiBarChart, FiTrendingUp, FiUsers, FiClock, FiRefreshCw, FiDownload } from 'react-icons/fi'
import { parseIntegerParam } from '@/utils/queryParams'

interface PatternAnalysis {
  activityPatterns: {
    hourlyDistribution: Record<number, number>
    dayOfWeekDistribution: Record<number, number>
    actionTypeDistribution: Record<string, number>
    peakHour: string
    totalActivities: number
    dataQuality?: {
      realDataCount: number
      testDataCount: number
      dataSource: 'real' | 'mixed' | 'test'
    }
  }
}

interface TrendData {
  series: Array<{
    date: string
    value: number
    unique_users?: number
    action_type?: string
  }>
  trends: {
    overall: {
      direction: 'up' | 'down' | 'stable'
      percentage: number
      change: number
    }
  }
  summary: {
    totalActivities: number
    averageWeeklyActivities: number
    peakWeek: any
  }
}

interface AnalyticsChartsProps {
  userId?: string
  days?: number
}

const ActivityAnalyticsCharts: React.FC<AnalyticsChartsProps> = ({ userId, days = 30 }) => {
  const [patternData, setPatternData] = useState<PatternAnalysis | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'patterns' | 'trends'>('patterns')
  const [excludeTest, setExcludeTest] = useState(true)
  const [trendPeriod, setTrendPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [trendWeeks, setTrendWeeks] = useState(8)
  const [topK, setTopK] = useState(8)

  const fetchAnalyticsData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // 패턴 분석 데이터
      const patternParams = new URLSearchParams({
        type: 'activity_patterns',
        days: days.toString(),
        ...(userId && { user_id: userId }),
        exclude_test: excludeTest ? 'true' : 'false',
      })

      const patternResponse = await fetch(`/api/admin/analytics/patterns?${patternParams}`)
      if (!patternResponse.ok) {
        throw new Error('패턴 데이터 조회 실패')
      }
      const patternResult = await patternResponse.json()
      setPatternData(patternResult)

      // 트렌드 분석 데이터
      const trendParams = new URLSearchParams({
        type: 'activity',
        period: trendPeriod,
        weeks: String(trendWeeks),
      })

      const trendResponse = await fetch(`/api/admin/analytics/trends?${trendParams}`)
      if (!trendResponse.ok) {
        throw new Error('트렌드 데이터 조회 실패')
      }
      const trendResult = await trendResponse.json()
      setTrendData(trendResult)
    } catch (err) {
      console.error('분석 데이터 조회 오류:', err)
      setError(err instanceof Error ? err.message : '데이터 조회에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }, [userId, days, excludeTest, trendPeriod, trendWeeks])

  useEffect(() => {
    fetchAnalyticsData()
  }, [userId, days, fetchAnalyticsData])

  const renderHourlyChart = (hourlyData: Record<number, number>) => {
    const hours = Array.from({ length: 24 }, (_, i) => i)
    const maxValue = Math.max(...Object.values(hourlyData), 1)

    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">시간대별 활동 분뺄</h4>
        <div className="grid grid-cols-12 gap-1 h-32">
          {hours.map(hour => {
            const count = hourlyData[hour] || 0
            const height = Math.max((count / maxValue) * 100, 2)

            return (
              <div key={hour} className="flex flex-col items-center">
                <div className="flex-1 flex items-end">
                  <div
                    className="w-full bg-blue-500 rounded-t transition-all duration-300 hover:bg-blue-600"
                    style={{ height: `${height}%` }}
                    title={`${hour}:00 - ${count}개`}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">{hour % 6 === 0 ? `${hour}h` : ''}</div>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>0h</span>
          <span>12h</span>
          <span>24h</span>
        </div>
      </div>
    )
  }

  const renderDayOfWeekChart = (dayData: Record<number, number>) => {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토']
    const maxValue = Math.max(...Object.values(dayData), 1)

    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">요일별 활동 분뺄</h4>
        <div className="grid grid-cols-7 gap-2 h-32">
          {dayNames.map((dayName, index) => {
            const count = dayData[index] || 0
            const height = Math.max((count / maxValue) * 100, 2)

            return (
              <div key={index} className="flex flex-col items-center">
                <div className="flex-1 flex items-end w-full">
                  <div
                    className="w-full bg-green-500 rounded-t transition-all duration-300 hover:bg-green-600"
                    style={{ height: `${height}%` }}
                    title={`${dayName}요일 - ${count}개`}
                  />
                </div>
                <div className="text-xs text-gray-700 mt-1 font-medium">{dayName}</div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderActionTypeChart = (actionData: Record<string, number>) => {
    const sortedActions = Object.entries(actionData)
      .sort(([, a], [, b]) => b - a)
      .slice(0, topK)

    const maxValue = Math.max(...sortedActions.map(([, count]) => count), 1)

    const actionLabels: Record<string, string> = {
      login: '로그인',
      logout: '로그아웃',
      post_created: '게시글 작성',
      post_updated: '게시글 수정',
      comment_created: '댓글 작성',
      like_added: '좋아요',
      like_removed: '좋아요 취소',
      profile_updated: '프로필 수정',
      file_uploaded: '파일 업로드',
      page_viewed: '페이지 조회',
    }

    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">활동 유형별 분뺄</h4>
        <div className="space-y-2">
          {sortedActions.map(([actionType, count]) => {
            const width = (count / maxValue) * 100

            return (
              <div key={actionType} className="flex items-center gap-3">
                <div
                  className="w-20 text-xs text-gray-600 truncate"
                  title={actionLabels[actionType] || actionType}
                >
                  {actionLabels[actionType] || actionType}
                </div>
                <div className="flex-1 bg-gray-200 rounded-full h-4 relative">
                  <div
                    className="bg-purple-500 h-4 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(width, 5)}%` }}
                  >
                    <span className="text-xs text-white font-medium">{count}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderTrendChart = (series: TrendData['series']) => {
    if (!series || series.length === 0) return null

    const maxValue = Math.max(...series.map(item => item.value), 1)

    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">주간 활동 트렌드</h4>
        <div className="grid grid-cols-8 gap-1 h-32">
          {series.map((item, index) => {
            const height = Math.max((item.value / maxValue) * 100, 2)
            const weekLabel = new Date(item.date).toLocaleDateString('ko-KR', {
              month: 'short',
              day: 'numeric',
            })

            return (
              <div key={index} className="flex flex-col items-center">
                <div className="flex-1 flex items-end w-full">
                  <div
                    className="w-full bg-orange-500 rounded-t transition-all duration-300 hover:bg-orange-600"
                    style={{ height: `${height}%` }}
                    title={`${weekLabel} - ${item.value}개`}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1 transform -rotate-45 origin-bottom-left">
                  {weekLabel}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case 'up':
        return <FiTrendingUp className="w-4 h-4 text-green-600" />
      case 'down':
        return <FiTrendingUp className="w-4 h-4 text-red-600 transform rotate-180" />
      default:
        return <FiBarChart className="w-4 h-4 text-gray-600" />
    }
  }

  const getTrendColor = (direction: string) => {
    switch (direction) {
      case 'up':
        return 'text-green-600'
      case 'down':
        return 'text-red-600'
      default:
        return 'text-gray-600'
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center">
          <div className="text-red-500 mb-2">
            <FiBarChart className="w-12 h-12 mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">분석 데이터 오류</h3>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <button
            onClick={fetchAnalyticsData}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <FiRefreshCw className="w-4 h-4 mr-2" />
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">활동 분석</h2>
          <div className="flex items-center gap-2">
            {/* 테스트 데이터 제외 토글 */}
            <label className="flex items-center gap-2 text-xs text-gray-700 bg-gray-100 px-2 py-1 rounded-md">
              <input
                type="checkbox"
                checked={excludeTest}
                onChange={e => setExcludeTest(e.target.checked)}
              />
              테스트 데이터 제외
            </label>
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('patterns')}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'patterns'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                패턴 분석
              </button>
              <button
                onClick={() => setActiveTab('trends')}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'trends'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                트렌드 분석
              </button>
            </div>
            <button
              onClick={fetchAnalyticsData}
              className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors"
            >
              <FiRefreshCw className="w-3 h-3 mr-1" />
              새로고침
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'patterns' && patternData && (
          <div className="space-y-8">
            {/* 상위 K 설정 */}
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                상위
                <select
                  value={topK}
                  onChange={e => setTopK(parseIntegerParam(e.target.value, 8, { min: 1 }))}
                  className="border rounded px-2 py-1 text-sm"
                >
                  {[5, 8, 10, 15].map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                개 표시
              </label>
              {patternData.activityPatterns.dataQuality && (
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    patternData.activityPatterns.dataQuality.dataSource === 'real'
                      ? 'bg-green-100 text-green-800'
                      : patternData.activityPatterns.dataQuality.dataSource === 'mixed'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  {patternData.activityPatterns.dataQuality.dataSource === 'real'
                    ? '✓ 실제 데이터'
                    : patternData.activityPatterns.dataQuality.dataSource === 'mixed'
                      ? `⚠ 혼합 데이터 (테스트 ${patternData.activityPatterns.dataQuality.testDataCount})`
                      : `⚠ 테스트 데이터 (${patternData.activityPatterns.dataQuality.testDataCount})`}
                </span>
              )}
            </div>
            {/* 데이터 품질 표시 */}
            {patternData.activityPatterns.dataQuality && (
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-2">데이터 소스</h4>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                        <span className="text-sm text-gray-700">
                          실제 데이터:{' '}
                          {patternData.activityPatterns.dataQuality.realDataCount.toLocaleString()}
                          개
                        </span>
                      </div>
                      {patternData.activityPatterns.dataQuality.testDataCount > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                          <span className="text-sm text-gray-700">
                            테스트 데이터:{' '}
                            {patternData.activityPatterns.dataQuality.testDataCount.toLocaleString()}
                            개
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                        patternData.activityPatterns.dataQuality.dataSource === 'real'
                          ? 'bg-green-100 text-green-800'
                          : patternData.activityPatterns.dataQuality.dataSource === 'mixed'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {patternData.activityPatterns.dataQuality.dataSource === 'real'
                        ? '✓ 실제 데이터'
                        : patternData.activityPatterns.dataQuality.dataSource === 'mixed'
                          ? '⚠ 혼합 데이터'
                          : '⚠ 테스트 데이터'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 요약 통계 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-900">총 활동</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {patternData.activityPatterns.totalActivities.toLocaleString()}
                    </p>
                  </div>
                  <FiBarChart className="w-8 h-8 text-blue-600" />
                </div>
              </div>

              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-900">피크 시간</p>
                    <p className="text-2xl font-bold text-green-900">
                      {patternData.activityPatterns.peakHour}:00
                    </p>
                  </div>
                  <FiClock className="w-8 h-8 text-green-600" />
                </div>
              </div>

              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-purple-900">활동 유형</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {Object.keys(patternData.activityPatterns.actionTypeDistribution).length}
                    </p>
                  </div>
                  <FiUsers className="w-8 h-8 text-purple-600" />
                </div>
              </div>
            </div>

            {/* 차트들 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                {renderHourlyChart(patternData.activityPatterns.hourlyDistribution)}
              </div>
              <div className="space-y-4">
                {renderDayOfWeekChart(patternData.activityPatterns.dayOfWeekDistribution)}
              </div>
            </div>

            <div>{renderActionTypeChart(patternData.activityPatterns.actionTypeDistribution)}</div>
          </div>
        )}

        {activeTab === 'trends' && trendData && (
          <div className="space-y-8">
            {/* 컨트롤: 기간/주 수 */}
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                기간
                <select
                  value={trendPeriod}
                  onChange={e => setTrendPeriod(e.target.value as any)}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value="daily">일간</option>
                  <option value="weekly">주간</option>
                  <option value="monthly">월간</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                윈도우(주)
                <select
                  value={trendWeeks}
                  onChange={e => setTrendWeeks(parseIntegerParam(e.target.value, 8, { min: 1 }))}
                  className="border rounded px-2 py-1 text-sm"
                >
                  {[4, 8, 12, 24].map(w => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* 트렌드 요약 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-orange-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-orange-900">전체 트렌드</p>
                    <div className="flex items-center gap-2">
                      {getTrendIcon(trendData.trends.overall.direction)}
                      <span
                        className={`text-lg font-bold ${getTrendColor(trendData.trends.overall.direction)}`}
                      >
                        {trendData.trends.overall.percentage > 0 ? '+' : ''}
                        {trendData.trends.overall.percentage}%
                      </span>
                    </div>
                  </div>
                  <FiTrendingUp className="w-8 h-8 text-orange-600" />
                </div>
              </div>

              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-900">주간 평균</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {Math.round(trendData.summary.averageWeeklyActivities)}
                    </p>
                  </div>
                  <FiBarChart className="w-8 h-8 text-blue-600" />
                </div>
              </div>

              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-900">총 활동</p>
                    <p className="text-2xl font-bold text-green-900">
                      {trendData.summary.totalActivities.toLocaleString()}
                    </p>
                  </div>
                  <FiUsers className="w-8 h-8 text-green-600" />
                </div>
              </div>
            </div>

            {/* 트렌드 차트 */}
            <div>{renderTrendChart(trendData.series)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ActivityAnalyticsCharts
