/**
 * 고급 필터 빌더 컴포넌트
 * 복합 필터 조건을 시각적으로 구성할 수 있는 UI 제공
 */

'use client'

import React, { useState } from 'react'
import { 
  FiFilter, 
  FiX, 
  FiSave,
  FiChevronDown,
  FiChevronRight,
  FiRefreshCw
} from 'react-icons/fi'
import type { 
  FilterOperator, 
  FieldDefinition,
  AdvancedSearchQuery
} from '@/types'
import { useAdvancedFilter } from '@/hooks/useAdvancedFilter'
import { FilterGroupRenderer } from './filters/FilterGroupRenderer'
import { SortConditionEditor } from './filters/SortConditionEditor'

interface AdvancedFilterBuilderProps {
  /** 필드 정의 목록 */
  fields: FieldDefinition[]
  /** 초기 필터 그룹 */
  initialFilters?: any
  /** 초기 정렬 조건들 */
  initialSorts?: any[]
  /** 변경 콜백 */
  onChange: (query: AdvancedSearchQuery) => void
  /** 저장 콜백 */
  onSave?: (query: AdvancedSearchQuery, name: string) => void
  /** 프리셋 로드 콜백 */
  onLoadPreset?: (presetId: string) => void
  /** 사용 가능한 프리셋 목록 */
  presets?: Array<{ id: string; name: string; description?: string }>
}

const AdvancedFilterBuilder: React.FC<AdvancedFilterBuilderProps> = ({
  fields,
  initialFilters,
  initialSorts = [],
  onChange,
  onSave,
  onLoadPreset,
  presets = []
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [activeTab, setActiveTab] = useState<'filters' | 'sorts'>('filters')

  // 연산자별 한글 이름
  const operatorLabels: Record<FilterOperator, string> = {
    equals: '같음',
    not_equals: '같지 않음',
    contains: '포함',
    not_contains: '포함하지 않음',
    starts_with: '시작',
    ends_with: '끝남',
    greater_than: '초과',
    greater_equal: '이상',
    less_than: '미만',
    less_equal: '이하',
    between: '범위',
    in: '목록에 포함',
    not_in: '목록에 미포함',
    is_null: '비어있음',
    is_not_null: '비어있지 않음'
  }

  const {
    filterGroup,
    sorts,
    addCondition,
    addGroup,
    updateCondition,
    removeCondition,
    removeGroup,
    updateGroupOperator,
    addSort,
    updateSort,
    removeSort,
    resetFilters,
    hasActiveFilters
  } = useAdvancedFilter({
    fields,
    initialFilters,
    initialSorts,
    onChange
  })

  // 저장 처리
  const handleSave = () => {
    if (!onSave || !presetName.trim()) return

    const query: AdvancedSearchQuery = {
      filters: filterGroup,
      sorts
    }

    onSave(query, presetName.trim())
    setShowSaveDialog(false)
    setPresetName('')
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-gray-100 rounded"
          >
            {isExpanded ? (
              <FiChevronDown className="w-5 h-5 text-gray-600" />
            ) : (
              <FiChevronRight className="w-5 h-5 text-gray-600" />
            )}
          </button>
          <FiFilter className="w-5 h-5 text-gray-600" />
          <h3 className="font-medium text-gray-900">고급 검색</h3>
          {hasActiveFilters && (
            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
              활성
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* 초기화 버튼 */}
          <button
            onClick={resetFilters}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            title="모든 필터 초기화"
          >
            <FiRefreshCw className="w-4 h-4" />
          </button>

          {/* 저장 버튼 */}
          {onSave && (
            <button
              onClick={() => setShowSaveDialog(true)}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              title="현재 설정 저장"
            >
              <FiSave className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 콘텐츠 */}
      {isExpanded && (
        <div className="p-4">
          {/* 프리셋 로드 */}
          {presets.length > 0 && (
            <div className="mb-6">
              <h4 className="font-medium text-gray-900 mb-2">저장된 설정</h4>
              <div className="flex flex-wrap gap-2">
                {presets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => onLoadPreset?.(preset.id)}
                    className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                    title={preset.description}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 탭 네비게이션 */}
          <div className="mb-4">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setActiveTab('filters')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'filters'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  필터 조건
                  {hasActiveFilters && (
                    <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
                      활성
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('sorts')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'sorts'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  정렬 조건
                  {sorts.length > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-800 text-xs rounded">
                      {sorts.length}개
                    </span>
                  )}
                </button>
              </nav>
            </div>
          </div>

          {/* 탭 콘텐츠 */}
          {activeTab === 'filters' ? (
            <FilterGroupRenderer
              group={filterGroup}
              groupPath={[]}
              level={0}
              fields={fields}
              operatorLabels={operatorLabels}
              onAddCondition={addCondition}
              onAddGroup={addGroup}
              onUpdateCondition={updateCondition}
              onRemoveCondition={removeCondition}
              onRemoveGroup={removeGroup}
              onUpdateGroupOperator={updateGroupOperator}
            />
          ) : (
            <SortConditionEditor
              sorts={sorts}
              fields={fields}
              onAdd={addSort}
              onUpdate={updateSort}
              onRemove={removeSort}
            />
          )}
        </div>
      )}

      {/* 저장 다이얼로그 */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium text-gray-900">설정 저장</h4>
              <button
                onClick={() => setShowSaveDialog(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                설정 이름
              </label>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="예: 최근 게시물 검색"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                autoFocus
              />
            </div>

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={!presetName.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdvancedFilterBuilder