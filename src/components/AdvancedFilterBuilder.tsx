/**
 * 고급 필터 빌더 컴포넌트
 * 복합 필터 조건을 시각적으로 구성할 수 있는 UI 제공
 */

'use client'

import React, { useState, useCallback } from 'react'
import { 
  FiPlus, 
  FiTrash2, 
  FiFilter, 
  FiX, 
  FiSave,
  FiChevronDown,
  FiChevronRight
} from 'react-icons/fi'
import type { 
  FilterGroup, 
  FilterCondition, 
  FilterOperator, 
  LogicalOperator,
  FieldDefinition,
  SortCondition,
  AdvancedSearchQuery
} from '@/types'

interface AdvancedFilterBuilderProps {
  /** 필드 정의 목록 */
  fields: FieldDefinition[]
  /** 초기 필터 그룹 */
  initialFilters?: FilterGroup
  /** 초기 정렬 조건들 */
  initialSorts?: SortCondition[]
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
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(
    initialFilters || { operator: 'AND', conditions: [], groups: [] }
  )
  const [sorts, setSorts] = useState<SortCondition[]>(initialSorts)
  const [isExpanded, setIsExpanded] = useState(true)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [presetName, setPresetName] = useState('')

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

  // 필터 조건 추가
  const addCondition = useCallback((group: FilterGroup, groupPath: number[] = []) => {
    const newCondition: FilterCondition = {
      field: fields[0]?.name || '',
      operator: fields[0]?.defaultOperator || 'equals',
      value: '',
      type: fields[0]?.type || 'string'
    }

    const updatedGroup = { ...group }
    let targetGroup = updatedGroup

    // 중첩 그룹 경로 탐색
    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    targetGroup.conditions = [...(targetGroup.conditions || []), newCondition]
    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [fields, sorts]) // eslint-disable-line react-hooks/exhaustive-deps

  // 필터 그룹 추가
  const addGroup = useCallback((parentGroup: FilterGroup, groupPath: number[] = []) => {
    const newGroup: FilterGroup = {
      operator: 'AND',
      conditions: [],
      groups: []
    }

    const updatedGroup = { ...parentGroup }
    let targetGroup = updatedGroup

    // 중첩 그룹 경로 탐색
    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    targetGroup.groups = [...(targetGroup.groups || []), newGroup]
    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [sorts]) // eslint-disable-line react-hooks/exhaustive-deps

  // 조건 업데이트
  const updateCondition = useCallback((
    conditionIndex: number, 
    updates: Partial<FilterCondition>,
    groupPath: number[] = []
  ) => {
    const updatedGroup = { ...filterGroup }
    let targetGroup = updatedGroup

    // 중첩 그룹 경로 탐색
    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    if (targetGroup.conditions && targetGroup.conditions[conditionIndex]) {
      const currentCondition = targetGroup.conditions[conditionIndex]
      
      // 필드가 변경된 경우 연산자와 값 초기화
      if (updates.field && updates.field !== currentCondition.field) {
        const fieldDef = fields.find(f => f.name === updates.field)
        updates.operator = fieldDef?.defaultOperator || 'equals'
        updates.type = fieldDef?.type || 'string'
        updates.value = ''
      }

      targetGroup.conditions[conditionIndex] = {
        ...currentCondition,
        ...updates
      }
    }

    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [filterGroup, fields, sorts]) // eslint-disable-line react-hooks/exhaustive-deps

  // 조건 삭제
  const removeCondition = useCallback((conditionIndex: number, groupPath: number[] = []) => {
    const updatedGroup = { ...filterGroup }
    let targetGroup = updatedGroup

    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    if (targetGroup.conditions) {
      targetGroup.conditions = targetGroup.conditions.filter((_, index) => index !== conditionIndex)
    }

    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [filterGroup, sorts]) // eslint-disable-line react-hooks/exhaustive-deps

  // 그룹 삭제
  const removeGroup = useCallback((groupIndex: number, groupPath: number[] = []) => {
    const updatedGroup = { ...filterGroup }
    let targetGroup = updatedGroup

    // 부모 그룹까지 경로 탐색
    for (let i = 0; i < groupPath.length - 1; i++) {
      if (targetGroup.groups && targetGroup.groups[groupPath[i]]) {
        targetGroup = targetGroup.groups[groupPath[i]]
      }
    }

    if (targetGroup.groups) {
      targetGroup.groups = targetGroup.groups.filter((_, index) => index !== groupIndex)
    }

    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [filterGroup, sorts]) // eslint-disable-line react-hooks/exhaustive-deps

  // 정렬 조건 추가
  const addSort = useCallback(() => {
    const newSort: SortCondition = {
      field: fields.find(f => f.sortable)?.name || '',
      direction: 'asc',
      priority: sorts.length
    }

    const updatedSorts = [...sorts, newSort]
    setSorts(updatedSorts)
    emitChange(filterGroup, updatedSorts)
  }, [fields, sorts, filterGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  // 정렬 조건 업데이트
  const updateSort = useCallback((index: number, updates: Partial<SortCondition>) => {
    const updatedSorts = sorts.map((sort, i) => 
      i === index ? { ...sort, ...updates } : sort
    )
    setSorts(updatedSorts)
    emitChange(filterGroup, updatedSorts)
  }, [sorts, filterGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  // 정렬 조건 삭제
  const removeSort = useCallback((index: number) => {
    const updatedSorts = sorts.filter((_, i) => i !== index)
    setSorts(updatedSorts)
    emitChange(filterGroup, updatedSorts)
  }, [sorts, filterGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  // 변경 이벤트 발생
  const emitChange = useCallback((filters: FilterGroup, sortConditions: SortCondition[]) => {
    const query: AdvancedSearchQuery = {
      filters,
      sorts: sortConditions.length > 0 ? sortConditions : undefined
    }
    onChange(query)
  }, [onChange])

  // 프리셋 저장
  const handleSave = useCallback(() => {
    if (onSave && presetName.trim()) {
      const query: AdvancedSearchQuery = {
        filters: filterGroup,
        sorts: sorts.length > 0 ? sorts : undefined
      }
      onSave(query, presetName.trim())
      setShowSaveDialog(false)
      setPresetName('')
    }
  }, [onSave, filterGroup, sorts, presetName])

  // 조건 렌더링
  const renderCondition = (
    condition: FilterCondition, 
    index: number, 
    groupPath: number[] = []
  ) => {
    const field = fields.find(f => f.name === condition.field)
    const availableOperators = field?.operators || ['equals']

    return (
      <div key={index} className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
        {/* 필드 선택 */}
        <select
          value={condition.field}
          onChange={(e) => updateCondition(index, { field: e.target.value }, groupPath)}
          className="text-sm border border-gray-300 rounded px-2 py-1 min-w-0 flex-1"
        >
          {fields.filter(f => f.filterable).map(field => (
            <option key={field.name} value={field.name}>
              {field.label}
            </option>
          ))}
        </select>

        {/* 연산자 선택 */}
        <select
          value={condition.operator}
          onChange={(e) => updateCondition(index, { operator: e.target.value as FilterOperator }, groupPath)}
          className="text-sm border border-gray-300 rounded px-2 py-1 min-w-0 flex-1"
        >
          {availableOperators.map(op => (
            <option key={op} value={op}>
              {operatorLabels[op]}
            </option>
          ))}
        </select>

        {/* 값 입력 */}
        {!['is_null', 'is_not_null'].includes(condition.operator) && (
          <div className="flex-1">
            {renderValueInput(condition, index, groupPath)}
          </div>
        )}

        {/* 삭제 버튼 */}
        <button
          onClick={() => removeCondition(index, groupPath)}
          className="p-1 text-red-600 hover:text-red-700 rounded"
        >
          <FiTrash2 className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // 값 입력 필드 렌더링
  const renderValueInput = (
    condition: FilterCondition, 
    index: number, 
    groupPath: number[] = []
  ) => {
    const field = fields.find(f => f.name === condition.field)

    if (condition.operator === 'between') {
      const values = Array.isArray(condition.value) ? condition.value : ['', '']
      return (
        <div className="flex space-x-1">
          <input
            type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
            value={values[0] || ''}
            onChange={(e) => updateCondition(index, { 
              value: [e.target.value, values[1]] 
            }, groupPath)}
            className="text-sm border border-gray-300 rounded px-2 py-1 flex-1"
            placeholder="시작"
          />
          <input
            type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
            value={values[1] || ''}
            onChange={(e) => updateCondition(index, { 
              value: [values[0], e.target.value] 
            }, groupPath)}
            className="text-sm border border-gray-300 rounded px-2 py-1 flex-1"
            placeholder="끝"
          />
        </div>
      )
    }

    if (['in', 'not_in'].includes(condition.operator)) {
      return (
        <input
          type="text"
          value={Array.isArray(condition.value) ? condition.value.join(', ') : condition.value}
          onChange={(e) => updateCondition(index, { 
            value: e.target.value.split(',').map(v => v.trim()).filter(Boolean)
          }, groupPath)}
          className="text-sm border border-gray-300 rounded px-2 py-1 w-full"
          placeholder="쉼표로 구분하여 입력"
        />
      )
    }

    if (field?.type === 'select' && field.options) {
      return (
        <select
          value={condition.value}
          onChange={(e) => updateCondition(index, { value: e.target.value }, groupPath)}
          className="text-sm border border-gray-300 rounded px-2 py-1 w-full"
        >
          <option value="">선택하세요</option>
          {field.options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }

    if (field?.type === 'boolean') {
      return (
        <select
          value={condition.value}
          onChange={(e) => updateCondition(index, { value: e.target.value === 'true' }, groupPath)}
          className="text-sm border border-gray-300 rounded px-2 py-1 w-full"
        >
          <option value="">선택하세요</option>
          <option value="true">예</option>
          <option value="false">아니오</option>
        </select>
      )
    }

    return (
      <input
        type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
        value={condition.value}
        onChange={(e) => updateCondition(index, { value: e.target.value }, groupPath)}
        className="text-sm border border-gray-300 rounded px-2 py-1 w-full"
        placeholder="값을 입력하세요"
      />
    )
  }

  // 그룹 렌더링
  const renderGroup = (group: FilterGroup, groupPath: number[] = [], level: number = 0) => {
    return (
      <div className={`border border-gray-200 rounded-lg p-4 ${level > 0 ? 'ml-4' : ''}`}>
        {/* 그룹 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-700">
              {level === 0 ? '필터 조건' : '하위 그룹'}
            </span>
            <select
              value={group.operator}
              onChange={(e) => {
                const updatedGroup = { ...filterGroup }
                let targetGroup = updatedGroup
                for (const index of groupPath) {
                  if (targetGroup.groups && targetGroup.groups[index]) {
                    targetGroup = targetGroup.groups[index]
                  }
                }
                targetGroup.operator = e.target.value as LogicalOperator
                setFilterGroup(updatedGroup)
                emitChange(updatedGroup, sorts)
              }}
              className="text-sm border border-gray-300 rounded px-2 py-1"
            >
              <option value="AND">모두 만족 (AND)</option>
              <option value="OR">하나 이상 만족 (OR)</option>
            </select>
          </div>
          
          {level > 0 && (
            <button
              onClick={() => removeGroup(groupPath[groupPath.length - 1], groupPath.slice(0, -1))}
              className="p-1 text-red-600 hover:text-red-700 rounded"
            >
              <FiTrash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 조건들 */}
        <div className="space-y-2 mb-4">
          {group.conditions?.map((condition, index) =>
            renderCondition(condition, index, groupPath)
          )}
        </div>

        {/* 중첩 그룹들 */}
        {group.groups?.map((nestedGroup, index) =>
          renderGroup(nestedGroup, [...groupPath, index], level + 1)
        )}

        {/* 추가 버튼들 */}
        <div className="flex space-x-2">
          <button
            onClick={() => addCondition(group, groupPath)}
            className="flex items-center px-3 py-1 text-sm text-blue-600 hover:text-blue-700 border border-blue-300 rounded hover:bg-blue-50"
          >
            <FiPlus className="w-4 h-4 mr-1" />
            조건 추가
          </button>
          <button
            onClick={() => addGroup(group, groupPath)}
            className="flex items-center px-3 py-1 text-sm text-green-600 hover:text-green-700 border border-green-300 rounded hover:bg-green-50"
          >
            <FiPlus className="w-4 h-4 mr-1" />
            그룹 추가
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center text-lg font-semibold text-gray-900"
        >
          {isExpanded ? (
            <FiChevronDown className="w-5 h-5 mr-2" />
          ) : (
            <FiChevronRight className="w-5 h-5 mr-2" />
          )}
          <FiFilter className="w-5 h-5 mr-2" />
          고급 필터
        </button>

        <div className="flex items-center space-x-2">
          {/* 프리셋 로드 */}
          {presets.length > 0 && (
            <select
              onChange={(e) => e.target.value && onLoadPreset?.(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
              defaultValue=""
            >
              <option value="">프리셋 선택</option>
              {presets.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          )}

          {/* 저장 버튼 */}
          {onSave && (
            <button
              onClick={() => setShowSaveDialog(true)}
              className="flex items-center px-3 py-1 text-sm text-gray-600 hover:text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
            >
              <FiSave className="w-4 h-4 mr-1" />
              저장
            </button>
          )}
        </div>
      </div>

      {/* 내용 */}
      {isExpanded && (
        <div className="p-4 space-y-6">
          {/* 필터 조건 */}
          {renderGroup(filterGroup)}

          {/* 정렬 조건 */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-700">정렬 조건</span>
              <button
                onClick={addSort}
                className="flex items-center px-3 py-1 text-sm text-blue-600 hover:text-blue-700 border border-blue-300 rounded hover:bg-blue-50"
              >
                <FiPlus className="w-4 h-4 mr-1" />
                정렬 추가
              </button>
            </div>

            <div className="space-y-2">
              {sorts.map((sort, index) => (
                <div key={index} className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
                  <select
                    value={sort.field}
                    onChange={(e) => updateSort(index, { field: e.target.value })}
                    className="text-sm border border-gray-300 rounded px-2 py-1 flex-1"
                  >
                    {fields.filter(f => f.sortable).map(field => (
                      <option key={field.name} value={field.name}>
                        {field.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={sort.direction}
                    onChange={(e) => updateSort(index, { direction: e.target.value as 'asc' | 'desc' })}
                    className="text-sm border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="asc">오름차순</option>
                    <option value="desc">내림차순</option>
                  </select>

                  <button
                    onClick={() => removeSort(index)}
                    className="p-1 text-red-600 hover:text-red-700 rounded"
                  >
                    <FiTrash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 저장 다이얼로그 */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">필터 프리셋 저장</h3>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="프리셋 이름을 입력하세요"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-4"
              autoFocus
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={!presetName.trim()}
                className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
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