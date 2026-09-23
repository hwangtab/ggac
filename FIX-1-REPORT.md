# 펀딩 적대 감사 3건 수리 보고

브랜치 `fix/funding-audit` · 워크트리
`/Users/hwang-gyeongha/ggac-worktrees/funding-audit-fix`

| 커밋      | 내용                                                             |
| --------- | ---------------------------------------------------------------- |
| `9cfcee4` | fix(펀딩): 공개 상세가 리워드 행을 통째로 내보내던 것을 막는다   |
| `f88a3c3` | fix(펀딩): 낡은 편집 범위로 공개된 프로젝트를 고치던 것을 막는다 |

---

## 1 · 캠페인 PATCH — 낡은 편집 범위

`src/app/api/mypage/funding/campaigns/[id]/route.ts`

### 무엇이 잘못됐나

PATCH가 ① 캠페인을 읽고 ② `editScope(campaign.status)`로 편집 범위를 정한 뒤 ③
그제야 `parseJsonObjectBody(request)`로 본문을 네트워크에서 읽었다. 본문이 언제
도착할지는 요청자가 정한다. `draft`(범위 `all`)로 PATCH를 열어 몇 바이트만
보내고 연결을 잡아 둔 채, 다른 요청으로 제출·승인해 `active`로 만든 다음 남은
본문을 흘리면, 라우트는 이미 낡은 `all` 범위로 검증한다.
`updateCampaignFields`는 `where(eq(id))`뿐이라 상태를 보지 않고 쓴다 — 공개돼
후원을 받고 있는 프로젝트의 제목과 목표 금액이 바뀐다.

관리자도 필요 없다. 개설자가 자기 `submit` 위로 연결을 걸쳐 두는 것만으로 심사
중 동결돼야 할 캠페인을 고칠 수 있다. 승인과 겹친 수백 밀리초의 평범한 네트워크
지연도 같은 결과를 낸다.

### 어떻게 고쳤나

**(가) 본문을 먼저 읽는다.** 이 저장소의 전이 라우트(`transition/route.ts`)가
이미 본문 → 캠페인 순서다. 같은 순서로 맞췄다.

**(나) 판정 근거가 된 상태를 쓰기 조건으로 건다.** `updateCampaignFields`에
`options.requireStatus`를 더해 `WHERE id = ? AND status = ?`로 쓰고, 0행이면
`null`을 돌려준다. 패치가 비어도 상태만 따로 확인한다(빈 패치만 확인을 건너뛰는
예외를 만들지 않으려고). 라우트는 `null`을 받으면 전이 라우트와 **같은 문구·같은
모양**의 409로 답한다 — `상태가 이미 바뀌었습니다. 새로고침해 주세요.`

### 왜 한쪽만으로는 부족한가

- **순서만 바로잡으면** 요청자가 창을 임의로 넓히는 능력은 사라지지만 창 자체는
  남는다. 본문을 다 읽은 뒤 캠페인을 읽고, 범위를 정하고, 검증하고, 쓰기까지
  여러 await가 있다. 그 사이에 승인이 커밋되면 여전히 `all` 범위로 공개 캠페인을
  쓴다. 폭이 좁아졌을 뿐 같은 버그다.
- **조건부 쓰기만 넣으면** 공격자가 창을 마음대로 벌릴 수 있다는 사실이
  그대로다. 연결을 잡고 있다가 승인 **직전**에 본문을 흘리면
  `WHERE status = 'draft'`가 아직 맞는 순간에 커밋된다 — 공격자가 타이밍을 고를
  수 있으면 조건부 쓰기의 경주에서 이길 확률을 임의로 높일 수 있다. 순서를 고쳐
  창을 사람이 조종할 수 없는 폭(서버 내부 지연)으로 줄여야 조건부 쓰기가 마지막
  방어선 노릇을 한다.

---

## 2 · 리워드 일괄 저장 — 같은 문제

`src/app/api/mypage/funding/campaigns/[id]/rewards/route.ts`

PUT도 캠페인 → `editScope` → `await request.json()` 순서였다. 낡은 `all`
범위에서는 `evaluateRewardPatch`의 `contentOnly` 가지가 통째로 건너뛰어지고,
아직 후원이 없는 리워드는 `locked_at`이 null이라 `ok`가 난다. 공개돼 돈을 받고
있는 프로젝트의 리워드를 다시 값 매기고, 수량을 줄이고, 지울 수 있었다. 삭제
경로도 마찬가지다 — `canDeleteReward`는 결제 유무만 보고, 공개 캠페인 삭제
금지는 `scope === 'contentOnly'` 한 줄이라 낡은 범위가 그 줄을 무력화한다.

### 어떻게 고쳤나

본문을 먼저 읽는 것은 1과 같다. 쓰기 쪽은 **문장이 여럿**이라는 점이 다르다 —
생성 여러 건, 수정 여러 건, 삭제 여러 건. 첫 문장 앞에서 상태를 한 번 확인하면
두 번째 문장부터는 다시 열린 창이 된다.

그래서 쿼리 계층에 `applyRewardBatch`를 두고 **세 종류의 쓰기를 한 트랜잭션**에
넣었다. 트랜잭션 맨 앞에서
`UPDATE funding_campaigns SET status = ? WHERE id = ? AND status = ?`로 상태를
확인한다. 읽기가 아니라 **조건부 쓰기**인 이유는, 이 문장이 트랜잭션에 시작부터
쓰기 잠금을 물려 아래 모든 문장이 같은 상태 위에서 돌게 하기 위해서다. 0행이면
`status_changed`로 되감는다. 리워드 잠금 경합 (`require_unlocked`, 검증과 쓰기
사이에 결제가 확정되는 경우)도 같은 트랜잭션 안에서 판정하므로, 하나가 거절되면
이미 실행된 생성·삭제까지 통째로 되감긴다.

덤으로 옛 코드가 감수하던 "DB 오류로 반쪽만 저장된 리워드 목록"도 사라졌다
(그래서 삭제를 맨 뒤로 미루던 배치 순서도 이제는 안전망이 아니라 취향이다 —
순서는 그대로 두었다).

라우트의 응답: `status_changed`는 전이 라우트와 같은 409 문구, `reward_locked`는
기존
문구(`'…' 리워드에 방금 후원이 들어왔습니다. 새로고침한 뒤 다시 시도해 주세요.`)를
그대로 유지했다.

---

## 3 · 공개 상세가 리워드 행을 통째로 내보내던 것

`src/app/api/funding/campaigns/[slug]/route.ts`가
`{ ...r, remaining_quantity }`로 DB 행을 그대로 폈다. 그 안에 `locked_at`(그
리워드에 처음 결제가 붙은 시각)이 들어 있다. 공개 후원자
명단(`/api/funding/campaigns/[slug]/backers`)은 `paid_at`을 밀리초까지 그대로
준다. 리워드를 처음 잠근 후원에 대해 두 값은 **같은 문자열**이라, 바깥 사람이
이름이 걸린 후원자 한 명을 특정 리워드 등급에, 따라서 특정 금액에 묶을 수
있었다.

`src/lib/funding/publicReward.ts`에 `toPublicReward`를 두었다 —
`toPublicCampaign`·`toPublicPledgeFields`와 같은 자리, 같은 모양. **지우는
목록이 아니라 싣는 목록**이라 표에 컬럼이 늘어도 저절로 새지 않는다.

### 싣는 필드와 그렇게 정한 근거

`id`, `title`, `description`, `amount`, `total_quantity`, `requires_shipping`,
`estimated_delivery`, `image_url` (+ 라우트가 붙이는 `remaining_quantity`)

확인한 소비자:

1. `src/app/[locale]/funding/types.ts`의 `Reward` — 위 아홉 개가 전부다. 이
   파일의 주석 자체가 "여기에 없는 필드는 화면으로 넘기지 않는다"고 못박는다.
2. `src/app/[locale]/funding/[slug]/page.tsx`의 `loadCampaign` — 서버 렌더
   경로가 **이미** 같은 아홉 개를 손으로 골라 담고 있다(API 경로만 규율
   밖이었다).
3. `src/app/[locale]/funding/[slug]/PledgeForm.tsx` — `id`, `title`, `amount`,
   `description`, `remaining_quantity`, `requires_shipping`,
   `estimated_delivery`를 읽는다. `/status` 폴링으로 `remaining_quantity`만
   갈아끼운다.
4. `src/app/api/funding/campaigns/[slug]/status/route.ts` — 리워드 행을 내보내지
   않고 `{ id: 남은수량 }` 지도만 만든다. 영향 없음.
5. `src/app/api/funding/campaigns/route.ts`(공개 목록) — 리워드를 싣지 않는다.
6. 개설자 화면(`/api/mypage/funding/campaigns/[id]`)은 `listRewards`를 그대로
   쓴다. 공개 라우트가 아니므로 건드리지 않았다.

뺀 것: `locked_at`(위 이유), `campaign_id`, `sort_order`(정렬은 서버가 이미
했다), `created_at`, `updated_at`.

---

## 검사

- `npm run lint` 통과, `npm run type-check` 통과, `npm run build` 통과
- `npm run test:unit` — **1545 pass / 0 fail / 4 skipped** (기준선 1538 + 신규
  7건). `SQLITE_BUSY` 플레이크 없음.

### 각 수리에 딸린 테스트 (없으면 깨지는 것을 실제로 확인했다)

문자열 매칭이 아니라 **로컬 DB를 상대로 쿼리 계층 함수를 직접** 부른다.

`scripts/testing/queriesFunding.test.mjs`

- `updateCampaignFields는 판정 근거 상태가 바뀌면 아무것도 쓰지 않는다`
- `updateCampaignFields는 빈 패치에서도 상태를 확인한다`
- `applyRewardBatch는 기대 상태가 아니면 생성·수정·삭제를 전부 되감는다`
- `applyRewardBatch는 잠긴 리워드 하나 때문에 배치 전체를 되감는다`
- `applyRewardBatch는 상태가 맞으면 생성·수정·삭제를 한 번에 반영한다`

`scripts/testing/fundingPublicReward.test.mjs`

- `공개 리워드는 locked_at을 싣지 않는다`
- `공개 리워드는 화면이 쓰는 필드만 싣는다`
- `표에 컬럼이 늘어도 저절로 새지 않는다`

역회귀 확인(가드를 임시로 껐을 때 실제로 빨간불이 들어오는지): `requireStatus`
조건을 빼면 앞의 두 건이 실패한다. `applyRewardBatch`의 상태 가드와 잠금 가드를
빼면 그 두 건이 실패한다. 둘 다 실측했고 되돌렸다.

---

## 남은 것 · 우려

- **본문을 먼저 읽는 순서 자체에는 단위 테스트가 없다.** 소스 문자열을 세는
  가드는 이 저장소가 이미 데인 방식이라 넣지 않았다. 순서가 되돌아가도 조건부
  쓰기 테스트는 계속 초록불이다 — 다만 그때도 실제 경계는 조건부 쓰기가 지킨다.
- `applyRewardBatch`의 상태 확인이 `status`를 자기 값으로 갱신하므로 리워드를
  저장할 때마다 캠페인의 `updated_at`이 갱신된다(`$onUpdate`). 표시에 쓰이는
  곳은 없어 영향은 없다고 봤으나, 잠금을 잡기 위해 일부러 쓰기로 둔 것이라 적어
  둔다.
- `messages/ko.json`·`messages/en.json`은 건드리지 않았다. 새 문구는 전부 API
  라우트의 한국어 인라인 문자열이고, 그중 409 문구는 전이 라우트에 이미 있는
  문장을 그대로 재사용했다.
- 워크트리에 빌드용 `.env.local`을 본체 저장소에서 복사해 두었다(gitignore 대상,
  커밋되지 않음).
