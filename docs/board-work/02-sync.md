# 이사회 업무툴 폴링 동기화 계약 — `POST /api/board-room/work/sync`

> 2026-10-29 작성. 설계 §6(`01-설계.md`)의 구현 계약이다. 원본 kosmart-work의
> Supabase Realtime(브로드캐스트·Presence·typing) 자리를 이 엔드포인트 하나가
> 대신한다. 타입 정본: `src/work/lib/sync/contract.ts`(라우트와 클라이언트가
> 같이 import한다). 라우트: `src/app/api/board-room/work/sync/route.ts`.

## 0. 한 줄 요약

클라이언트는 **보고 있는 채널마다 rev 하나**를 들고 있다가 3초마다 보낸다.
서버는 그 rev 이후 바뀐 메시지 id만 돌려주고, 클라이언트는 원본과 똑같이
`loadMessagesByIds`로 다시 읽는다. **응답 값은 신호일 뿐 화면 값이 아니다**(원본
`realtime.ts`가 브로드캐스트 payload를 믿지 않고 다시 읽던 것과 같다).

## 1. 커서(서버 쪽 규칙)

| 열                                 | 언제 오르나                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `work_channels.rev`                | 그 채널에서 화면에 보이는 것이 바뀌는 모든 쓰기: 새 메시지(답글·시스템 메시지 포함)·수정·삭제·반응 추가/제거·고정 추가/제거. **쓰기와 같은 트랜잭션**에서 1 오른다                                                                                |
| `work_messages.rev`                | 그 메시지가 바뀐 시점의 채널 rev. 새 글·수정·삭제·반응 변경, 그리고 **답글이 생기거나 지워져 답글 수가 바뀐 부모**                                                                                                                                |
| `work_channels.pins_rev`           | 고정 목록이 바뀐 시점의 채널 rev(고정·해제, **고정된 메시지가 지워졌을 때**). 따로 세지 않고 같은 rev를 적는다 → `pins_rev > 요청 rev`면 "고정이 바뀌었다"                                                                                        |
| `work_channels.tabs_rev`           | 대화 탭 추가·이름·순서·삭제, 메모 저장(바뀐 저장만), 할 일 만들기·고치기·완료·삭제(2b — 원본에는 할 일 신호가 없었지만 열린 할 일 탭이 갱신되게 했다). 같은 방식                                                                                  |
| `work_member_prefs.membership_rev` | 사용자 단위. 그 사람의 사이드바 목록 자체가 바뀔 때: 채널 참여·나가기·추가됨, 채널 생성(만든 사람), DM 열림(양쪽), 그룹 생성·사람 추가·이름 변경·나가기·내보내기(그룹 멤버 전원 + 나간/내보낸 사람), 채널 보관·해제(멤버 전원), `#전체` 자동 가입 |

멘션·읽음 표시는 rev를 올리지 않는다(개인 상태 — 응답의 `badges`가 매번 실어
준다).

## 2. 요청

```jsonc
POST /api/board-room/work/sync
Content-Type: application/json

{
  // 보고 있는 채널 → 마지막으로 반영한 rev. 최대 50개. 키는 uuid.
  // 처음 값은 화면 로더 `loadChannelViewData(...)`가 돌려주는 `rev`다.
  "channels": { "<channelId>": 12, "<threadChannelId>": 7 },
  // 마지막으로 본 사용자 단위 번호. 처음이면 null(membershipChanged는 false가 되고, 응답의 membershipRev를 저장한다)
  "membershipRev": 3,
  // 지금 보는 채널(입력 중 표시 대상)과 열린 스레드. 없으면 null
  "focus": { "channelId": "<uuid>", "threadId": "<uuid>|null" },
  // 입력 중 신호. 입력하면 최대 3초에 한 번 싣는다. scope = 스레드 부모 id(채널 입력창이면 null). 없으면 null
  "typing": { "channelId": "<uuid>", "scope": null }
}
```

- 잘못된 모양(uuid 아닌 키, 음수 rev, 51개 이상)은 **400**.
- 레이트 리밋 `WORK_SYNC`: 사용자당 분당 60회. 넘으면 **429**(`Retry-After`).

## 3. 응답

`ApiSuccess.ok` 규약이라 본문은 `{ success: true, data: <아래>, meta }`다.

```jsonc
{
  // rev가 바뀐 채널만. 읽을 수 없는 채널은 요청에 있어도 **절대** 나오지 않는다.
  "changed": {
    "<channelId>": {
      "rev": 15, // 다음 요청에 이 값을 보낸다
      "messageIds": ["<uuid>", "..."], // (요청 rev, rev] 사이에 바뀐 메시지(답글 포함). 최대 200
      "pinsChanged": false, // true → loadPinnedIds / loadPinnedMessages
      "tabsChanged": false, // true → 탭 다시 읽기(2단계)
      "resync": true, // (선택) 200개를 넘었다 → messageIds는 []. loadLatestMessages로 최신 페이지부터
    },
  },
  "membershipRev": 4,
  "membershipChanged": true, // 요청 값과 다르면 true → 사이드바 다시 그리기(router.refresh)
  "badges": {
    // getSidebarBadges()와 같은 모양(SidebarBadgeSnapshot). expense는 늘 없다
    "channels": { "<channelId>": { "unread": 2, "mentions": 1 } },
    "mentionCount": 1,
    "activityCount": 0,
    // (ggac에서 더함, R3) 내 열린 할 일 수 — 이사회실 메뉴 '할 일' 배지. 읽기 범위 안 채널만 센다
    "openTaskCount": 5,
  },
  "typing": [
    // focus 채널에서 5초 안에 입력한 사람(나 제외)
    { "userId": "<uuid>", "displayName": "홍길동", "scope": null },
  ],
  "online": ["<uuid>", "..."], // 60초 안에 sync를 보낸 사람(나 포함)
  "resync": false, // changed 중 하나라도 resync인가
  "serverTime": "2026-10-29T06:00:00.000Z",
}
```

| 상태 | 언제                                      |
| ---- | ----------------------------------------- |
| 200  | 정상                                      |
| 400  | 요청 모양이 틀렸다                        |
| 401  | 로그인 안 됨                              |
| 403  | 이사·감사·관리자가 아님(일반 조합원 포함) |
| 429  | WORK_SYNC 초과                            |

## 4. 권한(서버가 지키는 것)

1. 게이트: `requireBoardMember()` → `loadWorkStaff()`. 업무툴
   진입(`requireWorkStaff`)과 같은 `canAccessBoardRoom` 판정이다.
2. **요청의 채널 id는 읽기 범위(`readableChannelIds`)로 먼저 거른다.** 규칙은
   원본 `can_read_channel`(kosmart-work 0037): 멤버 / 공개 채널 + 내부 구성원 /
   비공개 채널 + 업무툴 관리자. **DM·그룹 채팅은 멤버만 — 관리자도 남의 DM은 못
   읽는다.** 거른 채널은 rev·메시지 id·고정 여부·배지 어느 것도 응답에 나오지
   않는다.
3. `typing`은 그 채널의 **멤버**일 때만 기록한다(원본 채널 토픽 쓰기 인가).
   읽기(`typing` 응답)는 focus 채널을 읽을 수 있으면 된다.
4. `messageIds`를 받은 뒤 다시 읽는 `loadMessagesByIds`도 같은 읽기 범위를 다시
   적용한다 (응답을 위조해 남의 id를 넣어도 새지 않는다).
5. 접속 시각(`work_presence`)은 30초에 한 번만 쓴다. 입력 중(`work_typing`)은
   덮어쓰고 5초 지난 행은 읽을 때 버린다.

권한 E2E: `e2e/authz-board-work.spec.ts`(이사↔비공개 채널, 관리자↔남의 DM,
조합원 403).

## 5. 클라이언트(`lib/messages/realtime.ts` 내부를 바꿀 때)

원본 `realtime.ts`의 **내보내는 API는 그대로 둔다**: `subscribeChannelTopic` ·
`subscribeUserTopic` · `subscribeWorkspacePresence` · `TopicEvent` ·
`TopicStatus` ·
`TopicHandle`(`unsubscribe`·`sendTyping`·`getStatus`·`getOnline`). 내부만 폴러
하나로 바꾼다.

- **폴러는 탭(브라우저 창)당 하나.** 구독 중인 채널 토픽의 rev를 모아 한 요청에
  싣는다.
- 주기(설계 §6-3): 채널·스레드를 보는 중 3초 / 채팅 화면이 아님 10초(배지만 —
  `channels: {}`) / 탭 숨김이면 멈추고 다시 보이면 즉시 1회 / 연속 실패
  3→6→12→30초 백오프(`status: 'error'`, `ChatStatus`의 "연결 끊김") / 메시지를
  보낸 직후 즉시 1회.
- 응답 → `TopicEvent` 매핑은 아래 표.

- `sendTyping(scope)`: 다음 요청의 `typing`에 싣고(3초에 한 번), 즉시 폴하지는
  않는다.
- 지워진 메시지는 하드 삭제가 아니라 소프트 삭제라 `loadMessagesByIds`가
  `deleted_at`이 찬 행을 돌려준다(원본 UPDATE와 같은 모양).

### 1b 구현 메모(`src/work/lib/messages/realtime.ts`)

- 원본 API에 **더한 것만** 있다: `subscribeBadges(listener)`(응답의 `badges`를
  사이드바가 받는다 — 채널마다 구독하지 않는다), `requestSync({ sentIn? })`(보낸
  직후 즉시 1회, 그 채널의 아직 싣지 않은 입력 중 신호는 버린다),
  `subscribeChannelTopic`의 선택 인자 `rev`(화면 로더의 시작
  커서)·`scope`(스레드 패널 → `focus.threadId`).
- 순수 규칙(주기·새 글 판정·활동 순서)은 `src/work/lib/sync/poll.ts`, 단위
  테스트는 `scripts/testing/boardWorkSyncClient.test.mjs`.
- 재조회(`loadMessagesByIds`)가 실패하면 그 채널의 rev를 올리지 않는다 — 다음
  폴이 같은 id를 다시 받는다(재시도). 4번 넘게 이어서 실패하면
  `sync-lost`('failed'), 배포로 낡은 탭이면 바로 `sync-lost`('stale-deploy').
- `resync`는 재연결 경로(`status` error → connected)로 알린다 — ChannelView는
  `refetchLatest`, ThreadPanel은 `loadThread`를 다시 부른다.
- 화면에 없던 id인지 클라이언트 허브는 모른다. 그래서 INSERT/UPDATE는 **지난
  응답 시각 뒤에 만들어졌고 고친 적 없는가**로 가른다(`messageOp`). 받는 쪽은
  둘을 같은 upsert로 처리한다.
- 메시지를 보내면 서버가 보낸 사람의 입력 중 행을 지운다(`sendMessage` →
  `clearTyping`). 행이 5초 남으면 보낸 뒤에도 "입력 중…"이 다시 실렸다. 화면의
  표시 유지 시간은 3초 폴과 맞게 5초다(원본 3초).
- 접속 수(채널 머리글)는 워크스페이스 접속자를 그 대화의 멤버로 좁혀 센다.
- `subscribeBadges`의 listener는 세 번째 인자로 `membershipChanged`를
  받는다(R3). 이사회실 메뉴 (`BoardWorkBadgesProvider`)가 업무 화면 밖에서 이
  신호를 받으면 대화 종류·뮤트 요약(`getWorkMenuSummary`)을 다시 읽는다 — 새로
  받은 DM이 다음 경로 이동 전까지 "채널"로 보여 숫자 배지 대신 점으로 나오던
  것을 막는다.

### 2b 구현 메모(대화 탭·메모·할 일)

- 탭 바(`ConversationTabBar`)는 채널 토픽을 구독해 `{ type: 'tabs' }`가 오면
  `router.refresh()`로 서버 렌더를 다시 부른다 (원본과 같다 — 값은 믿지 않는다).
  메모 탭(`NoteTabView` 보기 모드)·할 일 탭(`TasksView`)은 새 props로 바뀐다.
- **시작 커서는 탭 바 데이터(`loadTabBarData().rev`)로 넘긴다.** 서버가
  탭·메모·할 일을 읽기 **전에** 읽은 rev다. 커서를 첫 폴 응답에서 받으면(rev
  null), 화면을 그린 뒤 첫 폴 전에 다른 사람이 저장한 메모를 놓친다(E2E에서
  실측).
- 쓰기는 쿼리 층(`src/db/queries/work/{tabs,notes,tasks}.ts`)이 같은
  트랜잭션에서 `bumpChannelRev(tx, id, { tabs: true })`.

### 응답 → TopicEvent

| 응답                     | 내보낼 TopicEvent                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changed[c].messageIds`  | `loadMessagesByIds`로 다시 읽어 그 채널 토픽에 `type: 'message'`. 화면에 없던 id면 `op: 'INSERT'`, 있던 id면 `op: 'UPDATE'`. 반응도 이 경로로 온다(메시지 rev가 오른다 — `reaction` 이벤트는 따로 만들 필요가 없다). 결과에 없는 id는 `op: 'DELETE'` |
| `changed[c].resync`      | 원본 재연결 경로(`refetchLatest` → `loadLatestMessages`)                                                                                                                                                                                             |
| `changed[c].pinsChanged` | `{ type: 'pins' }`                                                                                                                                                                                                                                   |
| `changed[c].tabsChanged` | `{ type: 'tabs' }`                                                                                                                                                                                                                                   |
| `membershipChanged`      | 사용자 토픽에 `{ type: 'user', event: 'MEMBER_ADDED', channelId: null }`                                                                                                                                                                             |
| `badges`                 | 원본 `SidebarLiveUpdates`가 `getSidebarBadges()`로 받던 값 그대로(`applyBadgeSnapshot`). 사이드바는 매 응답으로 배지를 맞추면 되고 채널마다 구독할 필요가 없다                                                                                       |
| `typing`                 | focus 채널 토픽에 `{ type: 'typing', userId, displayName, scope }`(5초 표시는 원본 화면 로직 그대로)                                                                                                                                                 |
| `online`                 | 워크스페이스 presence 구독자에게 `{ type: 'presence', userIds: online }`                                                                                                                                                                             |
| 응답 실패                | `{ type: 'status', status: 'error' }` → 다음 성공 때 `'connected'`                                                                                                                                                                                   |

## 6. 하지 않는 것(알고 둔 차이)

- 원본 Presence의 채널별 접속(그 채널 화면을 보는 사람)은 없다. `online`은
  워크스페이스 전체다.
- 입력 중 표시는 원본보다 1~3초 늦다(폴링 주기).
- 푸시(5단계)와 무관하다 — 이 엔드포인트는 화면이 열려 있을 때만 돈다.
