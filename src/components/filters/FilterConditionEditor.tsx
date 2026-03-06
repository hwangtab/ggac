'use client'

import React from 'react'
import { FiTrash2 } from 'react-icons/fi'
import type { FilterCondition, FilterOperator, FieldDefinition } from '@/types'

interface FilterConditionEditorProps {
  condition: FilterCondition
  conditionIndex: number
  fields: FieldDefinition[]
  onUpdate: (index: number, updates: Partial<FilterCondition>) => void
  onRemove: (index: number) => void
  operatorLabels: Record<FilterOperator, string>
}

export const FilterConditionEditor: React.FC<FilterConditionEditorProps> = ({
  condition,
  conditionIndex,
  fields,
  onUpdate,
  onRemove,
  operatorLabels,
}) => {
  const field = fields.find(f => f.name === condition.field)

  // 필드 타입별 사용 가능한 연산자
  const getAvailableOperators = (fieldType: string): FilterOperator[] => {
    switch (fieldType) {
      case 'string':
      case 'text':
        return [
          'equals',
          'not_equals',
          'contains',
          'not_contains',
          'starts_with',
          'ends_with',
          'is_null',
          'is_not_null',
        ]
      case 'number':
      case 'integer':
        return [
          'equals',
          'not_equals',
          'greater_than',
          'greater_equal',
          'less_than',
          'less_equal',
          'between',
          'is_null',
          'is_not_null',
        ]
      case 'date':
      case 'datetime':
        return [
          'equals',
          'not_equals',
          'greater_than',
          'greater_equal',
          'less_than',
          'less_equal',
          'between',
        ]
      case 'boolean':
        return ['equals', 'not_equals']
      case 'select':
      case 'multiselect':
        return ['equals', 'not_equals', 'in', 'not_in']
      default:
        return ['equals', 'not_equals', 'contains']
    }
  }

  const availableOperators = getAvailableOperators(field?.type || 'string')

  // 값 입력 컴포넌트 렌더링
  const renderValueInput = () => {
    if (condition.operator === 'is_null' || condition.operator === 'is_not_null') {
      return null // null 체크는 값 입력 불필요
    }

    if (condition.operator === 'between') {
      const values = Array.isArray(condition.value) ? condition.value : ['', '']
      return (
        <div className="flex space-x-2">
          <input
            type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
            value={values[0] || ''}
            onChange={e =>
              onUpdate(conditionIndex, {
                value: [e.target.value, values[1] || ''],
              })
            }
            placeholder="시작값"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="flex items-center text-gray-500">~</span>
          <input
            type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
            value={values[1] || ''}
            onChange={e =>
              onUpdate(conditionIndex, {
                value: [values[0] || '', e.target.value],
              })
            }
            placeholder="끝값"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )
    }

    if (condition.operator === 'in' || condition.operator === 'not_in') {
      return (
        <textarea
          value={Array.isArray(condition.value) ? condition.value.join('\n') : condition.value}
          onChange={e =>
            onUpdate(conditionIndex, {
              value: e.target.value.split('\n').filter(v => v.trim()),
            })
          }
          placeholder="값을 줄바꿈으로 구분하여 입력"
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )
    }

    if (field?.type === 'select' && field.options) {
      return (
        <select
          value={condition.value as string}
          onChange={e => onUpdate(conditionIndex, { value: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          value={condition.value as string}
          onChange={e => onUpdate(conditionIndex, { value: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        value={condition.value as string}
        onChange={e => onUpdate(conditionIndex, { value: e.target.value })}
        placeholder="값을 입력하세요"
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    )
  }

  return (
    <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
      {/* 필드 선택 */}
      <div className="flex-1">
        <select
          value={condition.field}
          onChange={e => onUpdate(conditionIndex, { field: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {fields.map(field => (
            <option key={field.name} value={field.name}>
              {field.label}
            </option>
          ))}
        </select>
      </div>

      {/* 연산자 선택 */}
      <div className="flex-1">
        <select
          value={condition.operator}
          onChange={e => onUpdate(conditionIndex, { operator: e.target.value as FilterOperator })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {availableOperators.map(operator => (
            <option key={operator} value={operator}>
              {operatorLabels[operator]}
            </option>
          ))}
        </select>
      </div>

      {/* 값 입력 */}
      <div className="flex-2">{renderValueInput()}</div>

      {/* 삭제 버튼 */}
      <button
        onClick={() => onRemove(conditionIndex)}
        className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
        title="조건 삭제"
      >
        <FiTrash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
