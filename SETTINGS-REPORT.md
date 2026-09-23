# 관리자 시스템 설정 화면이 저장값을 그대로 말하게 한다

`value?.enabled || true` 한 관용구가 읽기 쪽 5곳, 쓰기 쪽 6곳에 반복돼 있었다.
`a || b`는 `false`까지 대체하므로, 관리자가 끈 값이 화면에서는 켜진 것으로
보이고(읽기) 같은 그룹의 다른 항목을 저장할 때마다 다시 켜졌다(쓰기).

- 읽기: `src/lib/server/systemSettingsMapping.ts`
- 쓰기: `src/app/api/admin/settings/route.ts` → 순수 빌더 넷으로 떼어내
  `systemSettingsMapping.ts`로 옮겼다(라우트는 `@/` 별칭 때문에 plain Node
  테스트가 못 부른다 — 이 결함이 테스트 없이 살아남은 이유가 그것이다).

## 자리 수에 대한 정정

`grep -n "|| true"`는 12줄을 준다. 그중 한 줄(`systemSettingsMapping.ts:92`)은
`funding_enabled` 위의 **설명 주석**이고, 실제 코드 자리는 **11곳**이다 (읽기
5 + 쓰기 6). 아래 표도 11행이다.

## 소비처가 정한 "값이 없을 때"

가장 중요한 사실부터: **이 11개 설정 중 실제로 값을 읽어 동작을 바꾸는 소비처는
하나도 없다.** 확인한 것:

- `src/utils/systemSettings.ts`의
  `isFeatureEnabled()`·`isRegistrationEnabled()`·
  `getFeatureFlags()`·`getSecurityPolicies()`는 **export돼 있으나 호출부가
  없다** (저장소 전체 grep). 값이 없을 때의 동작을 적어 둔 유일한 자리다.
- 미들웨어(`src/middleware/settings.ts`)가 읽는 것은 `site.maintenance_mode`와
  `site.registration_enabled.enabled` 둘뿐이고, 둘 다 이번 11곳이 아니다.
  (`registration_enabled` 행에서 이번에 손댄 것은 `require_approval` 형제
  필드다.)
- 비밀번호 요건은 Better Auth가 `minPasswordLength: 8`로 **하드코딩**돼 있고
  (`src/lib/auth/server.ts`), `require_uppercase` 따위를 읽는 코드는 없다.
  `src/utils/settingsValidation.ts`는 이 값들을 읽지 않고 리터럴로 적어 넣는다.
- 이메일 인증은 `emailAndPassword.requireEmailVerification`이 **꺼져 있다**
  (설정하지 않음 = false). 가입 시 메일은 보내지만(`sendOnSignUp: true`)
  인증하지 않아도 로그인된다. 즉 `require_email_verification` 토글은 무력하다.

그래서 기본값은 "없을 때의 동작을 선언한 유일한 코드"인 `getDefaultSettings()`(+
`isFeatureEnabled()`의 `?? true`)를 따랐다. 한 자리에서 그 선언이 서로 어긋난다
— **아래 ⚠ 항목**.

## 11곳

| #   | 설정(저장 경로)                                        | 자리 | 소비처가 "없을 때" 하는 일                                                                                                                                               | 표시(고친 뒤) | 저장(고친 뒤)                         |
| --- | ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------- |
| 1   | `features.board_features.enabled`                      | 읽기 | `isFeatureEnabled('board')` → `?? true` = **켜짐** (호출부 없음)                                                                                                         | `?? true`     | 화면이 보낸 값 그대로(원래 결함 없음) |
| 2   | `features.artist_features.registration_enabled`        | 읽기 | `isFeatureEnabled('artist_registration')` → `?? true` = **켜짐** (호출부 없음)                                                                                           | `?? true`     | 그대로                                |
| 3   | `features.comment_features.enabled`                    | 읽기 | `isFeatureEnabled('comments')` → `?? true` = **켜짐** (호출부 없음)                                                                                                      | `?? true`     | 그대로                                |
| 4   | `features.file_upload.enabled`                         | 읽기 | `isFeatureEnabled('file_upload')` → `?? true` = **켜짐** (호출부 없음)                                                                                                   | `?? true`     | 그대로                                |
| 5   | `security.email_verification.required`                 | 읽기 | ⚠ 읽는 코드 없음. Better Auth는 인증을 **요구하지 않는다**. `getDefaultSettings()`는 `false`, `/api/admin/settings/reset` 기본값 표는 `true` — **선언이 서로 어긋난다** | `?? false`    | 그대로                                |
| 6   | `site.registration_enabled.require_approval`           | 쓰기 | 읽는 코드 없음. `isRegistrationEnabled()`(호출부 없음)·`getDefaultSettings()`·reset 표 모두 **true**                                                                     | 화면에 없음   | `?? true`                             |
| 7   | `security.session_config.require_reauth_for_sensitive` | 쓰기 | 읽는 코드 없음. `getDefaultSettings()`·reset 표 모두 **true**                                                                                                            | 화면에 없음   | `?? true`                             |
| 8   | `security.login_policy.require_strong_password`        | 쓰기 | 읽는 코드 없음. 강도는 Better Auth `minPasswordLength: 8`이 전부. 선언값은 **true**                                                                                      | 화면에 없음   | `?? true`                             |
| 9   | `security.password_policy.require_uppercase`           | 쓰기 | 읽는 코드 없음. 선언값 **true**                                                                                                                                          | 화면에 없음   | `?? true`                             |
| 10  | `security.password_policy.require_lowercase`           | 쓰기 | 읽는 코드 없음. 선언값 **true**                                                                                                                                          | 화면에 없음   | `?? true`                             |
| 11  | `security.password_policy.require_numbers`             | 쓰기 | 읽는 코드 없음. 선언값 **true**                                                                                                                                          | 화면에 없음   | `?? true`                             |

대조군으로 `features.funding_features.enabled`는 원래부터 `=== true`였고 그대로
뒀다 — 소비처(`@/lib/funding/settings`의 `normalizeFundingSettings`)가 실제로
값을 읽고 `enabled === true`만 켜짐으로 판정하는, 이 표에서 유일하게 살아 있는
소비처다. `password_policy.require_special`은 기본값이 `false`라 `||`로도
저장값을 뒤집지 않았다(그래서 11곳에 들어가지 않는다). 그래도 `?? false`로 적어
다음 사람이 기본값만 보고 판단하지 않게 했다.

## 지금 화면에 보이는 값은 하나도 바뀌지 않는다

운영의 이 11개 값은 전부 `true`이고, `true ?? X === true`,
`true || X === true`다. `require_special`(`false`)은 11곳 밖이고 손대지 않았다.
**바뀌는 것은 "저장된 false"와 "값이 없을 때"의 동작뿐이며, 오늘 운영에는 그
둘이 없다.**

## `security.session_config` 행이 아예 없다는 사실의 의미

운영 `system_settings`에 이 행이 없다. 그러면:

- **읽기**: GET은 행을 순회하며 채우므로 `security.session_timeout`은 응답에서
  아예 빠진다. 즉 transform의 "값 없음" 가지는 *행이 없을 때*가 아니라 _행은
  있는데 JSON 안에 그 필드가 없을 때_ 실행된다.
- **쓰기**: `updateSystemSetting`은 UPSERT가 아니라 **UPDATE 전용**이고 대상이
  없으면 `SettingNotFoundError`를 던진다(`src/db/queries/settings.ts`). 그래서
  세션 타임아웃을 저장하면 `require_reauth_for_sensitive` 기본값을 계산하긴
  하지만 **한 번도 기록되지 않는다** — 그 그룹은 `errors`에 들어간다. 다시 말해
  7번 자리의 "없을 때" 가지는 계산만 되고 저장에는 도달하지 못한다. 관리자
  화면에서 세션 타임아웃은 **지금도 저장할 수 없다.** 이번 수리 범위 밖의 별개
  사실이라 손대지 않았다(고치려면 행을 만들거나 UPSERT로 바꿔야 하고, 둘 다 운영
  DB 쓰기·마이그레이션이 필요하다).

## 부분 실패가 관리자에게 도달하는지 — 확인함

PUT은 항목별로 저장하고, 일부가 실패해도 **200**에 `data.errors`를 담는다.

1. 라우트(`route.ts` 끝의 `ApiSuccess.ok`)는 `{ updated, errors }`를 `data`에
   넣고, `errors.length !== 0`이면 메시지도 실패 문구로 바꾼다.
2. 화면(`src/app/[locale]/admin/settings/page.tsx` 저장 핸들러)은 `response.ok`
   뒤에 `body?.data?.errors`를 읽어 하나라도 있으면 `throw` → 빨간 오류 문구를
   띄우고 `savedSettingsRef`를 갱신하지 않는다(갱신하면 그 항목이 다음 저장의
   diff에서 빠져 영영 못 고친다).
3. 이번 변경은 `updateResults`/`errorResults` 수집, `try/catch`, 응답 형태를
   건드리지 않았다. 바뀐 것은 `settingGroups[key]`에 담기는 **값**뿐이고, 저장
   호출과 실패 기록 경로는 그대로다. 성공으로 잘못 보고되는 경로는 늘지 않았다.

## 테스트

`scripts/testing/systemSettingsMapping.test.mjs`에 11곳 × (저장 true / 저장
false / 값 없음)을 더했다. "저장 true"만 봤다면 고치기 전에도 통과했다 — 이
결함이 그렇게 살아남았다.

고치기 전 코드로 되돌려 돌리면 **12건이 실패**한다(11곳 + 옛 관용구를 못박은
부정 대조 1건). 고친 뒤에는 전부 통과한다.
