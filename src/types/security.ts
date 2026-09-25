export type SecurityEventType =
  // 기본 보안 이벤트
  | 'INVALID_UUID_OR_TEMP_ID_FORMAT'
  | 'TEMP_ID_USAGE'
  | 'MALICIOUS_UUID_ATTEMPT'
  | 'SUSPICIOUS_PATTERN_DETECTED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT'
  | 'XSS_ATTEMPT'
  | 'XSS_PATTERN_DETECTED'
  | 'INJECTION_ATTEMPT'
  | 'FILE_UPLOAD_VIOLATION'
  | 'INVALID_FILE_TYPE'
  | 'SUSPICIOUS_FILE_UPLOAD'
  | 'AUTHENTICATION_FAILURE'
  | 'SESSION_MANIPULATION'

  // 콘텐츠 보안 이벤트
  | 'CONTENT_VALIDATION_FAILED'
  | 'MALICIOUS_CONTENT_BLOCKED'
  | 'UNSAFE_HTML_DETECTED'
  | 'BLOCKED_IMAGE_PROXY_REQUEST'
  | 'UNSAFE_URL_BLOCKED'
  | 'CONTENT_SIZE_VIOLATION'
  | 'CSP_VIOLATION'
  | 'CONTENT_SANITIZED'

  // 이미지 프록시 보안 이벤트
  | 'IMAGE_PROXY_BLOCKED_DOMAIN'
  | 'IMAGE_PROXY_INVALID_URL'
  | 'IMAGE_PROXY_SIZE_EXCEEDED'
  | 'IMAGE_PROXY_TIMEOUT'
  | 'IMAGE_PROXY_FETCH_ERROR'
  | 'IMAGE_PROXY_ERROR'
  | 'BLOCKED_IMAGE_DOMAIN'
  | 'MALICIOUS_IMAGE_DOMAIN'

  // Rate Limiting 이벤트
  | 'RATE_LIMIT_GENERAL_API_EXCEEDED'
  | 'RATE_LIMIT_AUTH_API_EXCEEDED'
  | 'RATE_LIMIT_ADMIN_API_EXCEEDED'
  | 'RATE_LIMIT_POST_CREATION_EXCEEDED'
  | 'RATE_LIMIT_SEARCH_API_EXCEEDED'
  | 'RATE_LIMIT_FILE_UPLOAD_EXCEEDED'
  | 'RATE_LIMIT_BULK_OPERATIONS_EXCEEDED'
  | 'RATE_LIMIT_BLOCKED_ACCESS'
  | 'RATE_LIMIT_AUTO_BLOCK'
  | 'RATE_LIMIT_MEMORY_FALLBACK'
  | 'RATE_LIMIT_DEGRADED_FAIL_OPEN'
  // 개인정보를 내보내는 읽기(`failClosedOnOutage`)에서 리미터가 없어
  // **열지 않고 막은** 경우. 사무국의 정상 업무가 멈추는 쪽이므로 눈에
  // 띄어야 한다 — Upstash를 고치라는 신호다.
  | 'RATE_LIMIT_DEGRADED_FAIL_CLOSED'

  // Admin API 보안 이벤트
  | 'ADMIN_ACTIVITY_API_ERROR'
  | 'ADMIN_MEMBERS_API_ERROR'
  | 'ADMIN_MEMBER_APPROVAL_ERROR'
  | 'ADMIN_MEMBER_UPDATE_ERROR'
  | 'ADMIN_MEMBER_ACTION_ERROR'
  // 관리자 화면을 잠글 뻔한 요청을 막았다 — 자기 자신 또는 마지막 관리자를
  // 비활성·정지·거부하려던 경우(`@/lib/members/adminLockoutGuard`).
  | 'ADMIN_LOCKOUT_BLOCKED'
  // 프로필 없는 계정("유령 회원") 복구 — 단계 4 Task 6b.
  // 관리자가 남의 계정에 프로필을 만드는 쓰기이므로 감사 로그에 남긴다.
  | 'ORPHAN_PROFILE_RECOVERED'
  | 'ADMIN_POSTS_API_ERROR'
  | 'ADMIN_POST_DELETE_ERROR'
  | 'ADMIN_POST_UPDATE_ERROR'
  | 'ADMIN_ARTISTS_API_ERROR'
  | 'ADMIN_ARTIST_UPDATE_ERROR'
  | 'ADMIN_ARTIST_DELETE_ERROR'
  | 'ADMIN_NOTIFICATIONS_API_ERROR'
  | 'ADMIN_NOTIFICATION_CREATE_ERROR'
  | 'ADMIN_NOTIFICATION_UPDATE_ERROR'
  | 'ADMIN_NOTIFICATION_DELETE_ERROR'
  | 'ADMIN_REPORTS_API_ERROR'
  | 'ADMIN_SETTINGS_API_ERROR'
  | 'ADMIN_SETTINGS_UPDATE_ERROR'
  | 'ADMIN_SETTINGS_ACCESS_ERROR'
  | 'ADMIN_SETTINGS_UPDATED'
  | 'ADMIN_SETTINGS_BACKUP_CREATED'
  | 'ADMIN_SETTINGS_BACKUP_ERROR'
  | 'ADMIN_SETTINGS_RESTORED'
  | 'ADMIN_SETTINGS_RESTORE_ERROR'
  | 'ADMIN_SETTINGS_RESET_TO_DEFAULTS'
  | 'ADMIN_SETTINGS_RESET_ERROR'
  | 'ADMIN_AUTH_ERROR'
  | 'ADMIN_PERMISSION_DENIED'
  | 'ADMIN_INVALID_REQUEST'
  | 'ADMIN_DATABASE_ERROR'
  | 'ADMIN_EXPORT_ERROR'

  // 회원 관리 이벤트
  | 'MEMBER_REGISTRATION_BLOCKED'
  | 'MEMBER_APPROVAL_FAILED'
  | 'MEMBER_STATUS_CHANGE_FAILED'
  | 'MEMBER_PROFILE_UPDATE_BLOCKED'
  | 'MEMBER_DELETION_BLOCKED'
  | 'INVALID_MEMBER_ACTION'
  | 'MEMBER_STATUS_CHANGED'
  | 'INVALID_MEMBER_SEARCH'
  // 탈퇴 확정 후 토스 빌링키 해지 실패 — 탈퇴 자체는 유효하다(우리 쪽
  // 결제 수단은 이미 지웠다), 다만 토스 쪽에 키가 남았을 수 있어 감사한다.
  | 'BILLING_KEY_REVOKE_FAILED'

  // 대량 작업 이벤트
  | 'INVALID_BULK_OPERATION'
  | 'BULK_OPERATION_COMPLETED'
  | 'BULK_OPERATION_ERROR'

  // 지원사업 다이제스트 이벤트 (단계 4 Task 7 — 관리자 발행)
  | 'GRANT_DIGEST_PUBLISHED'
  // 게시글·메일은 나갔는데 회차 상태 기록만 실패한 경우 — 회차가 'publishing'에
  // 갇히고 재발행 경로가 없어 사람이 손으로 고쳐야 한다(발행 라우트 주석 참고).
  | 'GRANT_DIGEST_PUBLISH_RECORD_FAILED'

  // 검색 이벤트
  | 'SEARCH_QUERY_BLOCKED'
  | 'SEARCH_INJECTION_ATTEMPT'
  | 'SEARCH_RATE_LIMIT_EXCEEDED'
  | 'INVALID_SEARCH_QUERY'

  // 설정 관리 이벤트
  | 'SETTINGS_UPDATE_BLOCKED'
  | 'SETTINGS_VALIDATION_FAILED'
  | 'ADMIN_SETTINGS_CACHE_INVALIDATED'
  | 'ADMIN_SETTINGS_CACHE_INVALIDATION_ERROR'

  // 파일 검증 관련 보안 이벤트
  | 'DANGEROUS_FILE_EXTENSION'
  | 'SUSPICIOUS_IMAGE_URL'
  | 'DANGEROUS_QUERY_PARAM'
  | 'IMAGE_WHITELIST_UPDATED'
  | 'IMAGE_BLACKLIST_UPDATED'
  | 'XSS_ATTEMPT_IN_EMAIL'
  | 'SQL_INJECTION_ATTEMPT'
  | 'MALICIOUS_PHONE_NUMBER'
  | 'MALICIOUS_USERNAME'
  | 'XSS_ATTEMPT_IN_TITLE'
  | 'XSS_ATTEMPT_IN_CONTENT'
  | 'MALICIOUS_URL'
  | 'MALICIOUS_FILENAME'
  | 'SQL_INJECTION_IN_SEARCH'
  | 'XSS_IN_SEARCH'

  // 관리자 메일함 수신 이벤트 (단계 4 Task 8 — Resend Inbound 웹훅)
  | 'MAILBOX_BODY_FETCH_FAILED'
  | 'MAILBOX_ATTACHMENT_COPY_FAILED'
  | 'MAILBOX_ATTACHMENT_LIST_FAILED'
  | 'MAILBOX_WEBHOOK_SIGNATURE_REJECTED'
  | 'MAILBOX_WEBHOOK_UNEXPECTED_ERROR'
  | 'MAILBOX_INBOUND_QUOTA_PRESSURE'
  | 'MAILBOX_RECIPIENT_NOT_ALLOWED'
  | 'ADMIN_MAILBOX_API_ERROR'
  // 답장 발송은 됐는데(되돌릴 수 없음) 기록(회신 원장·스레드 참조·상태 전이)
  // 중 하나가 실패한 경우 — Task 11. 던지면 관리자가 "실패"로 보고 재시도해
  // 같은 메일이 두 번 나간다. 그래서 던지지 않고 감사만 하고 200을 준다.
  | 'MAILBOX_REPLY_RECORD_FAILED'
  // 첨부 다운로드 라우트가 DB의 blob_path를 봉쇄 판정으로 재검증했을 때
  // 실패한 경우 — Task 12. 비공개 저장소에는 조합 DB 전체 덤프가 같이 산다.
  | 'MAILBOX_ATTACHMENT_PATH_REJECTED'
  // 이사·감사·관리자 첨부 다운로드 기록(logUserActivity)이 실패한 경우.
  // 기록 실패가 다운로드 자체를 막지 않으므로(브리프 C) 여기로만 남긴다.
  | 'MAILBOX_DOWNLOAD_AUDIT_FAILED'
  // 배송 목록 내보내기 기록(logUserActivity)이 실패한 경우. 후원자 전원의
  // 이름·연락처·주소가 한 파일로 나가는 요청이라, 기록이 없으면 누가 언제
  // 무엇을 가져갔는지 답할 길이 없다. 첨부 다운로드와 같은 판단으로 기록
  // 실패가 내려받기를 막지는 않되, 여기로 올린다.
  | 'FUNDING_SHIPPING_EXPORT_AUDIT_FAILED'
  // 정산 패널에 개설자의 입금 계좌를 실어 보내기 전 기록(logUserActivity)이
  // 실패한 경우. 배송 목록 내보내기와 같은 판단이다 — 기록이 없으면 누가 언제
  // 남의 계좌번호를 봤는지 답할 길이 없다. 조회 자체는 막지 않는다.
  | 'FUNDING_PAYOUT_ACCOUNT_VIEW_AUDIT_FAILED'
  // 등록된 계좌가 없는 개설자에게 지급을 기록하면서, 그 사실을 남기는 활동
  // 기록이 실패한 경우. 그 한 줄이 "사무국이 따로 확인한 계좌로 보냈다"는
  // 단서의 전부라, 없으면 근거 없이 지급을 주장하는 기록만 남는다.
  | 'FUNDING_SETTLEMENT_PAID_WITHOUT_ACCOUNT_AUDIT_FAILED'
  // 조합원 한 사람의 계좌를 사무국에 내보내기 전 기록이 실패한 경우. 목록에서
  // 계좌를 뺀 이유가 "누가 언제 남의 계좌를 봤는지 답할 수 있게"였으므로,
  // 기록이 빠지면 그 이유가 통째로 사라진다. 조회 자체는 막지 않는다.
  | 'MEMBER_ACCOUNT_VIEW_AUDIT_FAILED'
  // 이메일 인증 관문이 계정을 **판정하지 못해** 통과시킨 경우(설정·프로필
  // 조회 실패). 막지 않는 것은 의도이지만(Turso가 흔들린다고 전 조합원이 문
  // 앞에 서면 안 된다), 관문이 열려 있던 시간은 셀 수 있어야 한다.
  | 'EMAIL_VERIFICATION_GATE_FAILED_OPEN'
  // 만료 정리 스윕이 하루가 지나도 풀지 못한 결제 대기 선점. 그 스윕은 토스가
  // 승인했는데 우리 confirm이 유실된 결제를 구하는 유일한 장치라, 못 푸는 행이
  // 쌓이면 그 안에 "돈은 나갔는데 후원이 없는" 건이 섞여 있을 수 있다. 자동으로
  // 어느 쪽인지 정할 수 없어 사람에게 넘긴다 — 로그에만 남기고 끝내면 아무도
  // 보지 않는다.
  | 'FUNDING_STUCK_PENDING_HOLDS'
  // 토스가 승인(DONE)이라 답한 결제인데 확정할 후원이 없던 경우. 돈은 잡혀
  // 있고 환불은 나간 적이 없으며, 그 후원 행은 이미 `pending`을 벗어나 다음
  // 스윕의 목록에도 오르지 않는다 — 여기서 세지 않으면 아무도 다시 보지 않는
  // 돈이 된다. 사무국 공지와 함께 남긴다.
  | 'FUNDING_CAPTURED_WITHOUT_PLEDGE'
  // 사무국 대리 환불에서 토스 환불은 나갔는데 원장(`funding_pledges` ·
  // `payments`)을 갱신하지 못한 경우. 돈은 돌아갔는데 시스템은 `paid`로
  // 알고 있어 정산이 그 돈을 다시 창작자에게 주라고 말한다 — 손으로
  // 고치기 전까지 틀린 숫자가 살아 있다.
  | 'FUNDING_OFFICE_REFUND_LEDGER_FAILED'
  // 사무국 대리 환불의 활동 기록이 실패한 경우. 그 한 줄이 "누가 왜 남의
  // 결제를 돌려줬는가"의 전부다. 환불은 이미 나갔으므로 응답은 성공이다.
  | 'FUNDING_OFFICE_REFUND_AUDIT_FAILED'
  // 지급이 끝나지 않은 줄 알고 환불했는데, 그사이 정산 지급이 기록된 경우.
  // 지급된 정산서는 원장과 대조하지 않으므로(`isBasisStale`) 환불 전 숫자가
  // 그대로 굳는다 — 좁은 창이지만 조용히 지나가게 두지 않는다.
  | 'FUNDING_OFFICE_REFUND_AFTER_PAYOUT'
  // 사무국이 발송 표시를 되돌렸는데 그 기록이 실패한 경우. 되돌리기는 자동
  // 환불을 다시 여는 동작이라, 기록이 없으면 "왜 열렸는지" 답할 길이 없다.
  | 'FUNDING_FULFILLMENT_REVERSAL_AUDIT_FAILED'

  // 크론이 깨진 경우. Vercel 크론은 실패해도 아무에게도 말하지 않는다 —
  // 대시보드에 회색 줄 하나가 늘 뿐이고, 라우트가 500을 내든 예외로 죽든
  // 다음 실행이 같은 일을 또 시도할 뿐이다. 그 사이 멈춰 있는 것이 돈을
  // 맞추는 고리라면 며칠이 지나서야 사람 눈에 띈다(2026-09-04 예매 중단이
  // 정확히 그 모양이었다). 그래서 "고리가 돌지 않았다"는 사실만은 'high'로
  // 올려 보안 로그가 닿는 곳까지 내보낸다.
  | 'FUNDING_EXPIRE_CRON_FAILED'
  // 결제 스위치가 내려가 있어 만료 스윕이 통째로 건너뛰었는데, 정작 풀어야 할
  // 선점이 남아 있는 경우. 스윕은 "토스는 승인했는데 우리 confirm이 유실된"
  // 결제를 구하는 유일한 장치다 — 스위치를 내린 동안 그 건들은 아무도 보지
  // 않는다. 풀 것이 없으면 조용하다(스위치를 내린 것 자체는 사고가 아니다).
  | 'FUNDING_EXPIRE_SWEEP_SKIPPED'
  // 조합비 자동결제 크론이 실패한 경우. 한 달치 청구가 통째로 빠진다.
  | 'DUES_CHARGE_CRON_FAILED'
  // 메일함 백필 크론이 실패한 경우. 본문을 못 채운 수신 메일을 다시 가져오는
  // 유일한 경로라, 멈춰 있으면 Resend 보관 기한(30일)이 지나며 본문이 영영
  // 사라진다.
  | 'MAILBOX_BACKFILL_CRON_FAILED'

export type SecurityEventSeverity = 'low' | 'medium' | 'high'

export interface SecurityEventContext {
  readonly [key: string]: unknown
  readonly timestamp?: string
  readonly userAgent?: string
  readonly clientIP?: string
}

export interface CSPViolationReport {
  readonly 'document-uri': string
  readonly referrer: string
  readonly 'violated-directive': string
  readonly 'effective-directive': string
  readonly 'original-policy': string
  readonly disposition: string
  readonly 'blocked-uri': string
  readonly 'line-number'?: number
  readonly 'column-number'?: number
  readonly 'source-file'?: string
}

export interface CSPReportWrapper {
  readonly 'csp-report': CSPViolationReport
}

export interface TempFileCleanupResult {
  readonly message: string
  readonly cleaned: number
  readonly files: readonly {
    readonly id: string
    readonly fileName: string
  }[]
}

export interface TempFileCleanupStats {
  readonly total: number
  readonly active: number
  readonly expired: number
  readonly totalSize: number
  readonly expiredSize: number
  readonly expiredSizeMB: number
}
