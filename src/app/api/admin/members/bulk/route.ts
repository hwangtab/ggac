import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import type { BulkOperationRequest } from '@/types'
import { validateFormData } from '@/utils/validation'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST: 대량 멤버 작업 수행
export const POST = defineApiRoute<Partial<BulkOperationRequest>>({
  method: 'POST',
  name: 'api/admin/members/bulk',
  rateLimit: {
    ...RATE_LIMITS.BULK_OPERATIONS,
    keyGenerator: createUserKeyGenerator('bulk_operations'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: error => {
    console.error('Bulk members API error:', error)
    logSecurityEvent(
      'BULK_OPERATION_ERROR',
      {
        error: '서버 오류가 발생했습니다.',
      },
      'high'
    )
    return ApiError.internalServerError('대량 작업 처리 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body: requestData, auth }) => {
    const { db, user } = auth

    const { operation_type, member_ids, parameters = {} } = requestData

    // 기본 데이터 검증
    if (!operation_type || !member_ids || !Array.isArray(member_ids) || member_ids.length === 0) {
      return ApiError.badRequest('유효하지 않은 요청 데이터입니다.').toNextResponse()
    }

    // 대량 작업 수량 제한
    if (member_ids.length > 100) {
      return ApiError.badRequest('한 번에 최대 100명까지만 처리할 수 있습니다.').toNextResponse()
    }

    const sanitizedMemberIds: string[] = []
    for (const memberId of member_ids) {
      const memberIdValidation = validateUUID(memberId, '멤버 ID')
      if (!memberIdValidation.isValid) {
        return ApiError.badRequest('유효하지 않은 멤버 ID가 포함되어 있습니다.').toNextResponse()
      }
      sanitizedMemberIds.push(memberIdValidation.sanitized)
    }

    // 작업 타입 검증
    const allowedOperations = [
      'bulk_approve',
      'bulk_reject',
      'bulk_activate',
      'bulk_deactivate',
      'bulk_suspend',
    ]
    if (!allowedOperations.includes(operation_type)) {
      logSecurityEvent('INVALID_BULK_OPERATION', { operation_type, member_ids }, 'high')
      return ApiError.badRequest('유효하지 않은 작업 타입입니다.').toNextResponse()
    }

    // 정지 관련 데이터 검증
    if (operation_type === 'bulk_suspend') {
      if (parameters.suspension_reason) {
        const reasonValidation = validateFormData(
          { suspension_reason: parameters.suspension_reason },
          { suspension_reason: 'content' }
        )
        if (!reasonValidation.isValid) {
          return ApiError.badRequest('유효하지 않은 정지 사유입니다.').toNextResponse()
        }
      }

      if (parameters.suspension_until) {
        const datePattern = /^\d{4}-\d{2}-\d{2}$/
        if (!datePattern.test(parameters.suspension_until)) {
          return ApiError.badRequest('유효하지 않은 날짜 형식입니다.').toNextResponse()
        }
      }
    }

    // 대량 작업 로그 생성
    const { data: bulkOperation, error: bulkError } = await db
      .from('member_bulk_operations')
      .insert({
        operation_type,
        performed_by: user.id,
        member_ids: sanitizedMemberIds,
        parameters,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (bulkError) {
      console.error('Bulk operation log error:', bulkError)
      return ApiError.internalServerError('대량 작업 로그 생성에 실패했습니다.').toNextResponse()
    }

    // 작업 시작 표시
    await db
      .from('member_bulk_operations')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', bulkOperation.id)

    let successCount = 0
    let errorCount = 0
    const results: any[] = []

    try {
      // 벌크를 실제 벌크로 수행한다: 일괄 조회 1회 → 메모리 검증 → 대상 일괄
      // 업데이트 1회. 기존에는 멤버당 select+update를 순차 실행해 최대 100명이면
      // 202 왕복(수십 초·함수 타임아웃 위험)이었다(전수감사 API High 5).
      // updateData는 작업 타입별로 모든 대상에 동일하므로 일괄 update가 가능하다.
      const { data: targetMembers, error: targetsError } = await db
        .from('member_profiles')
        .select('id, display_name, registration_status, is_active, is_suspended')
        .in('id', sanitizedMemberIds)

      if (targetsError) {
        throw targetsError
      }

      const memberById = new Map((targetMembers || []).map(member => [String(member.id), member]))

      // 작업 타입별 자격 조건과 업데이트 데이터 (모든 대상 공통)
      const eligibility: Record<string, { status: string; message: string }> = {
        bulk_approve: { status: 'pending', message: '승인 대기 상태의 회원만 승인할 수 있습니다.' },
        bulk_reject: { status: 'pending', message: '승인 대기 상태의 회원만 거부할 수 있습니다.' },
        bulk_activate: { status: 'approved', message: '승인된 회원만 활성화할 수 있습니다.' },
        bulk_deactivate: { status: 'approved', message: '승인된 회원만 비활성화할 수 있습니다.' },
        bulk_suspend: { status: 'approved', message: '승인된 회원만 정지할 수 있습니다.' },
      }
      const requiredStatus = eligibility[operation_type]?.status
      const ineligibleMessage = eligibility[operation_type]?.message ?? '처리할 수 없는 작업입니다.'

      const nowIso = new Date().toISOString()
      const updateDataByType: Record<string, Record<string, unknown>> = {
        bulk_approve: {
          registration_status: 'approved',
          is_active: true,
          approved_by: user.id,
          approved_at: nowIso,
          updated_at: nowIso,
        },
        bulk_reject: {
          registration_status: 'rejected',
          is_active: false,
          rejected_by: user.id,
          updated_at: nowIso,
        },
        bulk_activate: {
          is_active: true,
          is_suspended: false,
          suspension_reason: null,
          suspension_until: null,
          updated_at: nowIso,
        },
        bulk_deactivate: {
          is_active: false,
          updated_at: nowIso,
        },
        bulk_suspend: {
          is_suspended: true,
          is_active: false,
          suspension_reason: parameters.suspension_reason || '관리자에 의한 대량 정지',
          suspension_until: parameters.suspension_until || null,
          updated_at: nowIso,
        },
      }
      const updateData = updateDataByType[operation_type]

      const eligibleIds: string[] = []
      for (const memberId of sanitizedMemberIds) {
        const targetMember = memberById.get(String(memberId))
        if (!targetMember) {
          errorCount++
          results.push({
            member_id: memberId,
            success: false,
            error: '회원을 찾을 수 없습니다.',
          })
          continue
        }
        if (targetMember.registration_status !== requiredStatus) {
          errorCount++
          results.push({
            member_id: memberId,
            member_name: targetMember.display_name,
            success: false,
            error: ineligibleMessage,
          })
          continue
        }
        eligibleIds.push(memberId)
      }

      if (eligibleIds.length > 0 && updateData) {
        const { error: updateError } = await db
          .from('member_profiles')
          .update(updateData)
          .in('id', eligibleIds)

        for (const memberId of eligibleIds) {
          const targetMember = memberById.get(String(memberId))
          if (updateError) {
            errorCount++
            results.push({
              member_id: memberId,
              member_name: targetMember?.display_name,
              success: false,
              error: '데이터베이스 업데이트에 실패했습니다.',
            })
          } else {
            successCount++
            results.push({
              member_id: memberId,
              member_name: targetMember?.display_name,
              success: true,
            })
          }
        }
      }

      // 작업 완료 표시
      await db
        .from('member_bulk_operations')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          results: {
            success_count: successCount,
            error_count: errorCount,
            details: results,
          },
        })
        .eq('id', bulkOperation.id)

      // 보안 이벤트 로깅
      logSecurityEvent(
        'BULK_OPERATION_COMPLETED',
        {
          operation_id: bulkOperation.id,
          operation_type,
          member_count: member_ids.length,
          success_count: successCount,
          error_count: errorCount,
          admin_id: user.id,
        },
        'medium'
      )

      return ApiSuccess.ok({
        operation_id: bulkOperation.id,
        summary: {
          total: member_ids.length,
          success: successCount,
          errors: errorCount,
        },
        results,
      })
    } catch (operationError) {
      console.error('Bulk operation error:', operationError)

      // 작업 실패 표시
      await db
        .from('member_bulk_operations')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: '작업 처리 중 오류가 발생했습니다.',
          results: {
            success_count: successCount,
            error_count: errorCount,
            details: results,
          },
        })
        .eq('id', bulkOperation.id)

      return ApiError.internalServerError('대량 작업 처리 중 오류가 발생했습니다.').toNextResponse()
    }
  },
})

// GET: 대량 작업 상태 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/members/bulk',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_members_bulk_status'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: error => {
    console.error('Bulk operations list API error:', error)
    return ApiError.internalServerError(
      '대량 작업 이력을 조회하는 중 오류가 발생했습니다.'
    ).toNextResponse()
  },
  handler: async ({ auth }) => {
    const { db } = auth

    // 대량 작업 이력 조회
    const { data: operations, error: operationsError } = await db
      .from('member_bulk_operations')
      .select(
        `
        id,
        operation_type,
        member_ids,
        parameters,
        results,
        status,
        created_at,
        started_at,
        completed_at,
        error_message,
        performed_by_member:member_profiles!performed_by (
          display_name,
          email
        )
      `
      )
      .order('created_at', { ascending: false })
      .limit(50)

    if (operationsError) {
      console.error('Operations fetch error:', operationsError)
      return ApiError.internalServerError('대량 작업 이력을 조회할 수 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok({
      operations: operations || [],
    })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
