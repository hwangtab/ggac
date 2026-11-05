import { ApiError } from '@/utils/apiWrapper'
import {
  RULE_ACTIONS,
  RULE_MATCH_TYPES,
  normalizeRuleValue,
  type RuleAction,
  type RuleMatchType,
} from '@/lib/mail/senderRules'

/** 규칙 조건 검증 — 만들기와 미리보기가 같이 쓴다. */
export function readRuleMatch(
  rawType: unknown,
  rawValue: unknown
): { matchType: RuleMatchType; matchValue: string } {
  if (!RULE_MATCH_TYPES.includes(rawType as RuleMatchType)) {
    throw ApiError.badRequest('조건은 주소 또는 도메인이어야 합니다.')
  }
  const matchType = rawType as RuleMatchType
  const matchValue = normalizeRuleValue(matchType, rawValue)
  if (!matchValue) {
    throw ApiError.badRequest(
      matchType === 'address' ? '메일 주소가 올바르지 않습니다.' : '도메인이 올바르지 않습니다.'
    )
  }
  return { matchType, matchValue }
}

export function readRuleAction(raw: unknown): RuleAction {
  if (!RULE_ACTIONS.includes(raw as RuleAction)) throw ApiError.badRequest('알 수 없는 동작입니다.')
  return raw as RuleAction
}
