import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 자동결제 카드(빌링키).
 *
 * 토스가 발급한 빌링키를 회원과 짝지어 보관한다. **한 번 발급된 빌링키는
 * 다시 조회할 수 없으므로**(토스 문서) 여기 저장에 실패하면 회원이 카드를
 * 다시 등록하는 수밖에 없다.
 *
 * 카드번호는 저장하지 않는다. 화면에 보여줄 카드사와 마스킹된 뒷자리만 남긴다.
 */

export const billingKeys = sqliteTable(
  'billing_keys',
  {
    id: uuidPk(),
    /**
     * 회원이 지워지면 카드도 함께 지운다. 결제 원장(`payments`)과 달리 이건
     * **결제 수단**이지 회계 기록이 아니다 — 남겨 둘 이유가 없고, 남기면
     * 지워진 회원의 카드로 청구할 수 있는 상태가 된다.
     */
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    /** 토스 빌링키. 카드번호와 같은 무게로 다룬다 — 응답·로그에 싣지 않는다. */
    billingKey: text('billing_key').notNull(),
    /** 빌링키와 짝이 맞아야 결제된다. 사실상 두 번째 비밀번호다. */
    customerKey: text('customer_key').notNull(),
    cardIssuerCode: text('card_issuer_code'),
    cardNumberMasked: text('card_number_masked'),
    cardType: text('card_type'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    deactivatedAt: integer('deactivated_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    /**
     * **회원당 활성 카드는 하나.** 부분 인덱스라 비활성 이력은 얼마든지 쌓인다.
     *
     * 두 장이 살아 있으면 크론이 어느 카드로 청구할지 임의로 고르게 되고,
     * 회원은 해지한 줄 아는 카드로 결제된다. 코드의 조건문에만 기대지 않고
     * DB 제약으로 막는다.
     *
     * 조건을 `eq(table.isActive, true)`가 아니라 raw SQL로 쓴다 — drizzle-kit이
     * 전자를 마이그레이션 SQL로 뽑을 때 값을 플레이스홀더(`= ?`)로 남겨
     * 실행되지 않는 인덱스를 만든다(실측, 0008 생성 시).
     */
    uniqueIndex('billing_keys_active_user_idx')
      .on(table.userId)
      .where(sql`"is_active" = 1`),
  ]
)
