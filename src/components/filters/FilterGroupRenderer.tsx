'use client'

import React from 'react'
import { FiPlus, FiTrash2 } from 'react-icons/fi'
import type { FilterGroup, FilterOperator, FieldDefinition } from '@/types'
import { FilterConditionEditor } from './FilterConditionEditor'

interface FilterGroupRendererProps {
  group: FilterGroup
  groupPath: number[]
  level: number
  fields: FieldDefinition[]
  operatorLabels: Record<FilterOperator, string>
  onAddCondition: (group: FilterGroup, groupPath: number[]) => void
  onAddGroup: (group: FilterGroup, groupPath: number[]) => void
  onUpdateCondition: (conditionIndex: number, updates: any, groupPath: number[]) => void
  onRemoveCondition: (conditionIndex: number, groupPath: number[]) => void
  onRemoveGroup: (groupIndex: number, groupPath: number[]) => void
  onUpdateGroupOperator: (operator: 'AND' | 'OR', groupPath: number[]) => void
}

export const FilterGroupRenderer: React.FC<FilterGroupRendererProps> = ({
  group,
  groupPath,
  level,
  fields,
  operatorLabels,
  onAddCondition,
  onAddGroup,
  onUpdateCondition,
  onRemoveCondition,
  onRemoveGroup,
  onUpdateGroupOperator,
}) => {
  const isRootGroup = level === 0
  const hasContent =
    (group.conditions && group.conditions.length > 0) || (group.groups && group.groups.length > 0)

  return (
    <div
      className={`
      relative border-l-2 pl-4 
      ${level === 0 ? 'border-blue-500' : level === 1 ? 'border-green-500' : 'border-orange-500'}
    `}
    >
      {/* 그룹 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {/* 논리 연산자 선택 */}
          <div className="flex bg-white border border-gray-300 rounded-md overflow-hidden">
            <button
              onClick={() => onUpdateGroupOperator('AND', groupPath)}
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                group.operator === 'AND'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              AND
            </button>
            <button
              onClick={() => onUpdateGroupOperator('OR', groupPath)}
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                group.operator === 'OR'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              OR
            </button>
          </div>

          <span className="text-sm text-gray-600">
            {group.operator === 'AND' ? '모든 조건을 만족' : '조건 중 하나를 만족'}
          </span>
        </div>

        {/* 그룹 삭제 버튼 (루트 그룹이 아닌 경우) */}
        {!isRootGroup && (
          <button
            onClick={() => onRemoveGroup(groupPath[groupPath.length - 1], groupPath)}
            className="p-1 text-red-600 hover:bg-red-50 rounded-md transition-colors"
            title="그룹 삭제"
          >
            <FiTrash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 조건들 */}
      {group.conditions && group.conditions.length > 0 && (
        <div className="space-y-2 mb-4">
          {group.conditions.map((condition, conditionIndex) => (
            <FilterConditionEditor
              key={conditionIndex}
              condition={condition}
              conditionIndex={conditionIndex}
              fields={fields}
              operatorLabels={operatorLabels}
              onUpdate={(index, updates) => onUpdateCondition(index, updates, groupPath)}
              onRemove={index => onRemoveCondition(index, groupPath)}
            />
          ))}
        </div>
      )}

      {/* 하위 그룹들 */}
      {group.groups && group.groups.length > 0 && (
        <div className="space-y-4 mb-4">
          {group.groups.map((subGroup, groupIndex) => (
            <FilterGroupRenderer
              key={groupIndex}
              group={subGroup}
              groupPath={[...groupPath, groupIndex]}
              level={level + 1}
              fields={fields}
              operatorLabels={operatorLabels}
              onAddCondition={onAddCondition}
              onAddGroup={onAddGroup}
              onUpdateCondition={onUpdateCondition}
              onRemoveCondition={onRemoveCondition}
              onRemoveGroup={onRemoveGroup}
              onUpdateGroupOperator={onUpdateGroupOperator}
            />
          ))}
        </div>
      )}

      {/* 추가 버튼들 */}
      <div className="flex space-x-2">
        <button
          onClick={() => onAddCondition(group, groupPath)}
          className="flex items-center px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
        >
          <FiPlus className="w-4 h-4 mr-1" />
          조건 추가
        </button>

        {level < 2 && ( // 최대 3단계까지만 중첩 허용
          <button
            onClick={() => onAddGroup(group, groupPath)}
            className="flex items-center px-3 py-2 text-sm text-green-600 hover:bg-green-50 rounded-md transition-colors"
          >
            <FiPlus className="w-4 h-4 mr-1" />
            그룹 추가
          </button>
        )}
      </div>

      {/* 빈 그룹 안내 */}
      {!hasContent && isRootGroup && (
        <div className="text-center py-8 text-gray-500">
          <p className="mb-2">아직 필터 조건이 없습니다.</p>
          <p className="text-sm">위의 "조건 추가" 버튼을 클릭하여 시작하세요.</p>
        </div>
      )}
    </div>
  )
}
