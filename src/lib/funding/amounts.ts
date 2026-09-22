/** 후원 금액 규칙. 네트워크·DB를 모른다. 라우트와 쿼리가 같은 함수를 부른다. */

export const MAX_QUANTITY = 10
export const MAX_ADDITIONAL_AMOUNT = 5_000_000
export const ADDITIONAL_AMOUNT_STEP = 1_000

export class PledgeAmountError extends Error {
  reason: 'quantity' | 'additional' | 'unit'
  constructor(reason: 'quantity' | 'additional' | 'unit', message: string) {
    super(message)
    this.name = 'PledgeAmountError'
    this.reason = reason
  }
}

export function computePledgeTotal(input: {
  unitAmount: number
  quantity: number
  additionalAmount: number
}): number {
  const { unitAmount, quantity, additionalAmount } = input
  if (!Number.isSafeInteger(unitAmount) || unitAmount <= 0) {
    throw new PledgeAmountError('unit', '리워드 금액이 올바르지 않습니다.')
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new PledgeAmountError('quantity', `수량은 1~${MAX_QUANTITY} 사이여야 합니다.`)
  }
  if (
    !Number.isSafeInteger(additionalAmount) ||
    additionalAmount < 0 ||
    additionalAmount > MAX_ADDITIONAL_AMOUNT ||
    additionalAmount % ADDITIONAL_AMOUNT_STEP !== 0
  ) {
    throw new PledgeAmountError(
      'additional',
      `추가 후원금은 ${ADDITIONAL_AMOUNT_STEP.toLocaleString()}원 단위로 ${MAX_ADDITIONAL_AMOUNT.toLocaleString()}원까지입니다.`
    )
  }
  return unitAmount * quantity + additionalAmount
}
