import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

// 원래 브리프는 이 테스트를 `src/lib/server/__tests__/systemSettingsWrite.test.ts`에
// 두라고 했지만, 이 저장소의 `npm run test:unit`은
// `node --experimental-strip-types --test scripts/testing/*.test.mjs`로
// `scripts/testing/` 바로 아래의 `.test.mjs` 파일만 줍는다(하위 디렉터리 재귀
// 없음, jest/vitest 등 별도 러너 없음 — `src` 안에는 `__tests__` 디렉터리도
// `.test.ts` 파일도 전혀 없었다). 그 경로에 두면 `npm run test:unit`이 이
// 파일을 영영 실행하지 않는다. 그래서 기존 관례(`signup-profile.test.mjs`가
// `../../src/lib/auth/signupProfile.ts`를 상대 경로로 직접 import하는 방식)를
// 따라 이 위치로 옮기고, import 경로만 그에 맞게 바꿨다. 테스트 로직 자체는
// 브리프 원문과 동일하다.
import {
  SettingNotFoundError,
  updateSystemSetting,
} from '../../src/lib/server/systemSettingsWrite.ts'

/** Supabase 클라이언트의 최소 스텁. update().eq().eq().select() 체인만 흉내낸다. */
function stubAdmin(result) {
  const calls = []
  const chain = {
    update(payload) {
      calls.push({ op: 'update', payload })
      return chain
    },
    eq(column, value) {
      calls.push({ op: 'eq', column, value })
      return chain
    },
    select() {
      calls.push({ op: 'select' })
      return chain
    },
    then(resolve) {
      resolve(result)
    },
  }
  return {
    calls,
    client: { from: table => (calls.push({ op: 'from', table }), chain) },
  }
}

describe('updateSystemSetting', () => {
  it('갱신된 행의 id를 돌려준다', async () => {
    const { client } = stubAdmin({ data: [{ id: 'row-1' }], error: null })
    const result = await updateSystemSetting(client, {
      category: 'site',
      settingKey: 'maintenance_mode',
      settingValue: { enabled: true },
      actorId: 'admin-1',
    })
    assert.equal(result.id, 'row-1')
  })

  it('actorId를 updated_by에 기록한다 — auth.uid()가 아니라', async () => {
    const { calls, client } = stubAdmin({ data: [{ id: 'row-1' }], error: null })
    await updateSystemSetting(client, {
      category: 'site',
      settingKey: 'maintenance_mode',
      settingValue: { enabled: true },
      actorId: 'admin-1',
    })
    const update = calls.find(c => c.op === 'update')
    assert.equal(update.payload.updated_by, 'admin-1')
    assert.ok(update.payload.updated_at, 'updated_at도 함께 써야 한다 (트리거에 의존하지 않는다)')
  })

  it('대상 설정이 없으면 SettingNotFoundError를 던진다', async () => {
    const { client } = stubAdmin({ data: [], error: null })
    await assert.rejects(
      () =>
        updateSystemSetting(client, {
          category: 'site',
          settingKey: '없는키',
          settingValue: {},
          actorId: 'admin-1',
        }),
      SettingNotFoundError
    )
  })

  it('category와 setting_key로 대상을 정확히 좁힌다 — 같은 카테고리의 다른 키까지 건드리지 않는다', async () => {
    const { calls, client } = stubAdmin({ data: [{ id: 'row-1' }], error: null })
    await updateSystemSetting(client, {
      category: 'site',
      settingKey: 'maintenance_mode',
      settingValue: { enabled: true },
      actorId: 'admin-1',
    })
    const eqCalls = calls.filter(c => c.op === 'eq')
    const eqCategory = eqCalls.find(c => c.column === 'category')
    const eqSettingKey = eqCalls.find(c => c.column === 'setting_key')
    assert.ok(eqCategory, 'category 필터가 쿼리에 있어야 한다')
    assert.equal(eqCategory.value, 'site')
    assert.ok(eqSettingKey, 'setting_key 필터가 쿼리에 있어야 한다')
    assert.equal(eqSettingKey.value, 'maintenance_mode')
  })
})
