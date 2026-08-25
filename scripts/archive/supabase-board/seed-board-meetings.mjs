// 이사회 과거 회의록/안건지(docs/이사회)를 board-room 시스템에 일괄 입력하는 일회성 seed.
// 회의록 본문은 원본 파일을 그대로 board_minutes.content(markdown)에 넣고,
// 안건은 board_agendas에 입력한다. created_at을 회의 날짜로 맞춰 최신 회의가 목록 상단에 오게 한다.
// 멱등: 같은 title+meeting_date 회의가 이미 있으면 건너뛴다.
//
// 실행: node scripts/seed-board-meetings.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// .env.local 직접 파싱 (dotenv 의존 회피)
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락')
  process.exit(1)
}
if (url.includes('54321')) {
  console.error('로컬 URL 감지 — 운영 대상이 아니므로 중단')
  process.exit(1)
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const DOCS = path.join('docs', '이사회')

const meetings = [
  {
    label: '제1차 이사회',
    date: '2025-07-30',
    location: '온라인 (Zoom)',
    source_file: '2025-07-30_제1차_이사회.md',
    agendas: [
      {
        title: '조합원 증대 방안',
        content:
          '생산자 협동조합 특성상 무분별한 조합원 증가는 일거리 분배 문제를 야기하므로 적정 인원 기준이 필요하다는 데 공감하고, 생산자 조합원 30명 내외 제한 및 결원 충원 방안이 제시됐다. 음악가 외 디자이너·시각예술가 영입과 후원자 조합원 제도 활용도 논의됐다. 가입 의사를 밝힌 김동산 님에게 가입 절차를 안내하기로 하고, 적정 인원과 영입 방안은 차기 이사회에서 추가 논의하기로 했다.',
        status: 'discussed',
      },
      {
        title: '매출 증대 방안',
        content:
          '단기 수익보다 금융기관 신용평가에 유리한 매출액 규모를 키우는 것을 목표로 명확히 했다. 에이전시 역할(기획업 등록 후 계약 대행), 네이버 스마트스토어 상품 판매, 교육 프로그램 기획 등 아이디어가 제시됐다. 각 조합원의 스킬셋을 파악해 교육 프로그램을 구체화하기로 했고, 사바하 이사장 기획 공연을 조합 명의로 진행해 매출을 발생시키기로 했다.',
        status: 'resolved',
      },
      {
        title: '공연장 등 협력 증대 방안',
        content:
          '클럽 엘리웨이, 안양 퍼플홀 등과의 우호적 협력 관계를 공유하고, 거거덩 협동조합이 8월 9일 주최하는 레코드 마켓에 조합 차원으로 참여하기로 했다. 음반·굿즈 판매나 오픈마이크 공연을 희망하는 조합원은 사바하 이사장을 통해 참여 신청을 하기로 했다.',
        status: 'resolved',
      },
      {
        title: '음반, 공연 등 협력 제작 방안',
        content:
          "조합 정체성을 보여줄 컴필레이션 음반 아이디어가 나왔으나, 인위적 컴필레이션보다 조합원들이 데모·스케치 음원을 자유롭게 공유하는 '데모 아카이브' 구축이 더 유기적이라는 의견에 공감대가 형성됐다. 공연 제작에서는 '철조망' 투어처럼 서로의 기획에 품앗이로 협력하는 문화를 장려하기로 했다. 데모 아카이브는 용량 한계 등 기술 문제 해결을 전제로 장기 과제로 긍정 검토하기로 했다.",
        status: 'discussed',
      },
    ],
  },
  {
    label: '제2차 이사회',
    date: '2025-08-26',
    location: '온라인 (Zoom)',
    source_file: '2025-08-26_제2차_이사회.md',
    agendas: [
      {
        title: '조합원 운영 정책 확정의 건',
        content:
          "1차에서 제안된 '생산자 조합원 30명 내외' 안을 재논의했으며, 현재 약 15명 수준이고 다양한 분야가 복합 활동하는 점을 고려해 당장 엄격히 제한하기보다 유연하게 지속 논의하기로 했다. 30명 내외를 장기 목표로 두되 당분간은 제한 없이 모집하며 추이를 지켜보기로 결정했다. 비음악인·후원자 혜택은 교육 프로그램 논의와 연계해 구체화하기로 했다.",
        status: 'resolved',
      },
      {
        title: '조합 매출 증대 실행 계획 수립의 건',
        content:
          "교육 프로그램의 핵심은 '장소'라는 데 의견을 모으고, 합주실과 강의 공간을 갖춘 ACME 스튜디오와 수익 분배 모델을 논의하는 것이 가장 현실적 대안으로 제시됐다. 온라인 MD 사업으로 조합 명의 네이버 스마트스토어를 개설해 로잘린송 이사 비즈 공예품부터 판매하기로 했다. 곽민 이사가 ACME와 교육 협력 방안을 논의하고, 황경하 이사가 조합원 스킬셋 조사 게시물을 올리기로 결정했다.",
        status: 'resolved',
      },
      {
        title: "조합원 협업 플랫폼 '데모 아카이브' 구축의 건",
        content:
          "데모 음원 공유·피드백 플랫폼으로 사운드클라우드, 유튜브, 밴드캠프 등이 거론됐고 접근성과 음악 중심 기능 사이에서 의견이 갈렸다. 특정 플랫폼 종속보다 각자 편한 곳에 올린 뒤 웹사이트에 링크를 모아 아카이빙하자는 제안도 나왔으며, '홍보'보다 교류·아카이빙에 목적을 둬야 한다는 데 공감했다. 즉각 결론을 내리기 어려워 차기 이사회에서 다시 심도 있게 논의하기로 했다.",
        status: 'discussed',
      },
    ],
  },
  {
    label: '제3차 이사회',
    date: '2025-09-29',
    location: '온라인 (Zoom)',
    source_file: '2025-09-29_제3차_이사회.md',
    agendas: [
      {
        title: '하반기 주요 공연 및 행사 협력 요청의 건',
        content:
          "10~11월 예정된 조합원 주관 공연 성공을 위해 조합 차원의 협력이 필요하다는 데 의견을 모았다. 조상퇴마 공공서비스(10.5), ACME LIVE 영상 촬영(10.12), SATANIC RITUAL & PERVERSIONS VOL. II(11.1), 유동혁&김동산 DOT 공연(11.2) 등에 대해 온라인 홍보, 촬영 스태프, 현장 티켓팅 등 '품앗이' 협력을 요청하기로 결정했다.",
        status: 'resolved',
      },
      {
        title: '로잘린송 이사 정규 앨범 발매 지원의 건',
        content:
          '로잘린송 이사가 내년 초 발매를 목표로 정규 앨범을 준비 중임을 공유했고, 뮤콘 성과를 바탕으로 이를 조합의 첫 공식 지원 프로젝트로 삼자는 제안이 나왔다. 뮤콘에서 구축한 해외 네트워크를 활용한 메일링 서비스를 시작해 홍보 인프라를 조합 자산으로 만들자는 전략도 논의됐다. 해당 앨범을 조합의 공식 지원 프로젝트로 선정하고 홍보·기획 역량을 집중하기로 의결했다.',
        status: 'resolved',
      },
      {
        title: "'예술 활동 상담소'(가제) 운영의 건",
        content:
          '2차에서 논의된 교육 프로그램을 구체화해 지역 음악가에게 실질적 도움을 주는 상담 프로그램을 운영하기로 했다. 11월 16일(토) 오후 ACME 스튜디오에서 예술활동증명, 공연 기획, 음반 제작 등 조합원 전문 분야별 멘토링·상담을 제공하기로 결정했다. 공익적 활동인 동시에 외부 네트워크 확장 기회로 평가됐다.',
        status: 'resolved',
      },
    ],
  },
  {
    label: '제4차 이사회',
    date: '2025-10-31',
    location: '온라인 (Zoom)',
    source_file: '2025-10-31_제4차_이사회.md',
    agendas: [
      {
        title: '사바하 이사장 정규 앨범 제작 지원의 건',
        content:
          'ACME 스튜디오에서 녹음을 완료하고 황경하 이사가 믹싱·마스터링 중인 현황을 공유했다. 로잘린송 이사 앨범에 이어 사바하 이사장 앨범을 조합의 두 번째 공식 지원 프로젝트로 선정해 홍보·유통·쇼케이스를 함께 진행하자는 제안이 나왔고, 아트워크 등 전문 디자이너 협업 필요성도 논의됐다. 공식 지원 프로젝트로 선정하고 세부 계획 수립을 위한 기획단(TF)을 구성하기로 의결했다.',
        status: 'resolved',
      },
      {
        title: '11월 주요 행사 종합 지원 계획 수립의 건',
        content:
          '11월 예정된 3개 주요 행사의 최종 지원 계획을 점검하고 역할을 분담했다. SATANIC RITUAL & PERVERSIONS VOL. II(11.1)는 공간 꾸미기·티켓팅 지원, 유동혁·김동산 블루이웃 공연(11.9)은 SNS 온라인 홍보, 수원 사운드 마켓(11.23)은 타임테이블·현장 운영·경매 등 역할 분담을 확정하고 전 조합원 협력을 요청하기로 결정했다.',
        status: 'resolved',
      },
      {
        title: "'ACME 예술인 상담회' 일정 조정의 건",
        content:
          '11월에 수원 지역 행사가 집중되어 행사 집중도와 참여율을 높이기 위해 11월 16일 예정이던 예술인 상담회를 연기할 필요가 있다는 데 의견을 모았다. 상담회를 1개월 연기해 12월 중으로 개최하기로 의결했으며, 구체적 날짜는 12월 중순경 다시 조율하기로 했다.',
        status: 'resolved',
      },
      {
        title: '예술인 금융 문제 공론화 논의',
        content:
          "김동수 이사가 한겨레 신문 인터뷰 내용을 공유하며 예술인이 금융권에서 '무직자'로 분류되어 겪는 어려움을 제기했다. 단순 복지를 넘어 기본적 경제 활동 권리의 문제라는 데 공감하고, 향후 조합 차원에서 이 문제를 공론화하고 해결 방안을 모색할 필요가 있다는 데 공감대를 형성했다.",
        status: 'discussed',
      },
    ],
  },
  {
    label: '제5차 이사회',
    date: '2025-11-28',
    location: '온라인 (Zoom)',
    source_file: '2025-11-28_제5차_이사회.md',
    agendas: [
      {
        title: "'예술인 공정금융' 권리 찾기 캠페인 및 행사 지원의 건",
        content:
          "예술인을 '무직'으로 취급하는 금융 시스템 문제에 공감하고, 정치적 압박이 필요하다는 Simon DM 이사 의견에 동의했다. 곽민 이사가 제안한 SNS 릴레이 캠페인 '#예술가는무직자가아니다'에 조합원들이 적극 참여 중임을 공유했다. 12월 2일 '예술인 공정금융 비전 선포식'에 가능한 조합원이 현장 참석하고, 조합 차원에서 이슈를 지속 알리며 금융권·정치권에 목소리를 전달하기로 결정했다.",
        status: 'resolved',
      },
      {
        title: '사바하 이사장 정규 앨범 제작 지원의 건',
        content:
          '추석 연휴 ACME 스튜디오에서 녹음을 완료했으나 믹싱/마스터링 등 후반 작업이 다소 지연되는 현황을 공유했다. 내년 1분기(3월경) 발매를 목표로 하고, 커버 아트워크는 외부 디자이너 섭외 또는 페이크 다큐 형식 촬영 등을 논의했다. 황경하·곽민 이사가 믹싱/마스터링 실무를 지원하고, 발매 시점에 맞춰 기획단(TF)을 꾸려 쇼케이스·프로모션을 구체화하기로 결정했다.',
        status: 'resolved',
      },
      {
        title: "'ACME 예술인 상담회' 및 '망년회' 통합 개최의 건",
        content:
          "11월 행사 집중으로 연기된 상담회를 연말 모임과 연계하고, 단순 상담회를 넘어 지역 예술인이 교류하는 '망년회' 형식으로 확장하기로 했다. 일시는 12월 중순(15~20일 유력, 투표 확정), 장소는 DOT 또는 ACME 스튜디오로 정했다. 1부 상담회 멘토링 + 2부 망년회 식사·네트워킹 형식으로 외부 예술인도 초청하기로 결정했다.",
        status: 'resolved',
      },
    ],
  },
  {
    label: '제6차 이사회',
    date: '2025-12-28',
    location: 'ACME 스튜디오 (오프라인)',
    source_file: '2025-12-28_제6차_이사회.md',
    agendas: [
      {
        title: '이사 3인 조합 탈퇴 및 사임 처리의 건',
        content:
          '로잘린송, Simon DM(김정수), 최원일 이사를 대상으로 하며 로잘린송·Simon DM은 사임서 제출·날인을 완료하고 최원일은 제출 대기 중인 현황을 공유했다. 사임으로 등기 이사 수가 부족(홀수 구성 필요)해져 비등기 이사 중 1인을 등기 이사로 추가 선임해야 한다는 점이 논의됐다. 다만 성원 미충족으로 법적 의결이 불가능해 차기 이사회에서 사임 승인 및 신임 이사 선임을 정식 처리하기로 했다.',
        status: 'discussed',
      },
      {
        title: '업무용 협업 툴 전환의 건 (Slack → Lark)',
        content:
          "비용 절감과 업무 효율화를 위해 유료 전환이 필요한 Slack 대신 무료이면서 기능이 강력한 올인원 협업 툴 'Lark'로 이전을 제안했다. 사바하 이사장이 Lark 가입 및 데이터 이전을 주도하고, 주진태 감사가 개인 서버를 활용한 데이터 저장 공간 제공 의사를 밝혔다. (성원 미충족 간담회로 정식 의결 없이 논의됨)",
        status: 'discussed',
      },
      {
        title: '예술 활동 지원을 위한 공용 소프트웨어 구독의 건',
        content:
          "디자인 툴 'Canva'와 AI 음악 창작 툴 'Suno' 프리미엄 버전을 조합 공용으로 구독해 활용하는 방안을 제안했다. Canva는 비전문가도 수준 높은 홍보물 제작이 가능해 1개 계정 공유 방식 운영이, Suno는 편곡 아이디어 스케치 활용이 검토됐다. 조합원 수요 조사를 거쳐 구독을 진행하기로 했다.",
        status: 'discussed',
      },
      {
        title: '2026년 1월 신규 공연 기획 공유 및 지원의 건',
        content:
          "철조망 III: METAL SYNDICATE NETWORK 3(1.11, 수원 DOT)과 옴니버스 공연 '새, 나뭇잎, 고양이, 그리고 강'(1.17, 수원 DOT) 두 기획을 공유했다. 철조망 III는 강정마을 네트워크 뮤지션과 신인 '강가 히말라야' 소개 예정으로 관람 독려·식사 네트워킹을, 옴니버스 공연은 온/오프라인 홍보를 지원하기로 했다.",
        status: 'discussed',
      },
    ],
  },
  {
    label: '2026년 제1차 이사회',
    date: '2026-01-30',
    location: '온라인',
    source_file: '2026-01-30_2026년_제1차_이사회_안건지.md',
    agendas: [
      {
        title: '이사 3인 사임 승인의 건',
        content:
          '로잘린송, Simon DM(김정수), 최원일 이사를 대상으로 한다. 제출된 사임서를 수리하고 법적 퇴임 절차를 진행하는 의결을 상정한다. (안건지 사전 검토 안건)',
        status: 'proposed',
      },
      {
        title: '신임 이사 보선(선출)의 건',
        content:
          '이사 사임에 따른 공석 보충 및 등기 이사 수 충족을 위해 제안됐다. 후보자 승인 및 등기 이사 선임을 의결하는 안건으로 상정된다. (안건지 사전 검토 안건)',
        status: 'proposed',
      },
      {
        title: '공용 소프트웨어 구독 예산 추인 및 계획 확정의 건',
        content:
          '지난 회의 논의에 따라 실행된 소프트웨어 구독 건의 공식 승인과 향후 계획 확정을 위해 상정됐다. Canva는 선제적으로 구독을 시작한 지출을 추인하고 계정 공유 방식을 안내하며, Suno는 11월(블랙프라이데이 등) 할인 프로모션 시기까지 구독을 보류하는 결정을 공식화한다.',
        status: 'proposed',
      },
      {
        title: "2월 공연 '건강열전' 홍보 및 지원의 건",
        content:
          '2월 22일(일) 수원 롱플레이어에서 희우·유동혁·야마가타 트윅스터가 출연하며, 작년 9월 취소됐던 기획의 재개로 조합 로고가 포함된 공식 후원 행사다. 조합 공식 SNS 홍보 일정 수립, 조합원 단체 관람 독려 및 예매 지원, 현장 스태프 등 지원 사항을 검토하는 안건이다.',
        status: 'proposed',
      },
    ],
  },
  {
    label: '2026년 제2차 이사회',
    date: '2026-03-06',
    location: '온라인 (Zoom)',
    source_file: '2026-03-06_2026년_제2차_이사회.md',
    agendas: [
      {
        title: '사바하 이사장 정규 앨범 발매 쇼케이스 기획 확정의 건',
        content:
          '공유된 역할 분담을 바탕으로 쇼케이스 실행 체계를 음향 RB, 촬영 황경하·곽민 이사, 현장 운영 이시원으로 확정했다. 쇼케이스 일정·장소 및 홍보 세부 계획은 믹싱 완료 시점(3월 중순) 이후 기획단(TF) 중심으로 구체화하기로 결정했다.',
        status: 'resolved',
      },
      {
        title: '2026년 상반기 사업 계획 수립의 건',
        content:
          'ACME 예술인 상담소는 정기총회와 같은 날 4월 주말 ACME 스튜디오에서 통합 개최하기로 하고 곽민 이사가 일정을 확인하기로 했다. 수원 사운드 마켓은 RB 조합원이 4~5월 중 수원 DOT에서 기획·진행하고 조합이 홍보·운영을 지원하기로 했다. 철조망 IV 등 봄 시즌 공연, 스마트스토어 MD 사업, 대중문화예술기획업 등록 등도 논의·동의했다.',
        status: 'resolved',
      },
      {
        title: '2025년도 정기총회 개최 준비의 건',
        content:
          '총회를 4월 주말 ACME 예술인 상담소와 같은 날 ACME 스튜디오에서 개최하기로 결정했다. 구체적 날짜는 곽민 이사의 ACME 일정 확인 후 최종 확정하고, 총회 안건 및 소집 공지는 개최일 7일 전까지 이사장이 발송하기로 했다.',
        status: 'resolved',
      },
      {
        title: '조합원 스킬셋 공유 및 데모 아카이브 운영 방안 확정의 건',
        content:
          '데모 아카이브 플랫폼으로 사운드클라우드(SoundCloud)를 최종 선택했다. 조합 공용 사운드클라우드 계정 개설은 이사장 최희철이 담당하고, 조합원 개인 사운드클라우드 주소는 이번 주 내로 단체 대화방을 통해 취합하기로 결정했다.',
        status: 'resolved',
      },
    ],
  },
  {
    label: '2026년 제3차 이사회',
    date: '2026-04-02',
    location: '온라인 (Lark 화상회의)',
    source_file: '2026-04-02_2026년_제3차_이사회_안건지.md',
    agendas: [
      {
        title: '2026년 신규 예술지원사업(공모사업) 지원 논의 및 프로필 취합의 건',
        content:
          '봄 시즌을 맞아 경기문화재단·수원문화재단 등 예술지원사업 공고가 본격화됨에 따라 사전 준비가 필요하다는 배경에서 상정됐다. 현재/예정 지원사업 목록을 공유해 공연·음반·다원예술 등 지원 대상을 선정하고, 기획서·자격 증빙을 위해 Lark 공용 폴더로 조합원 전원의 상세 프로필(사진, 음원/영상 링크, 이력)을 기한 내 취합하는 방안을 논의한다. (안건지 사전 검토 안건)',
        status: 'proposed',
      },
      {
        title: "기획 공연 '철조망 IV' 홍보 및 협력 요청의 건",
        content:
          '2026년 4월 11일(토) 오후 8시 수원 앨리웨이탭하우스에서 Liberalia, Panzerkorps, Meridies, Sabbaha 라인업으로 열리는 무료입장·유료퇴장 공연이다. 조합 공식 SNS 및 Canva 활용 맞춤 홍보 콘텐츠 업로드(주진태 감사 협조)와 조합원 개인 SNS 릴레이 홍보 및 당일 현장 관람·음주 독려를 논의한다. (안건지 사전 검토 안건)',
        status: 'proposed',
      },
      {
        title: '2026년도 경기아트콜렉티브 정기총회 개최 준비의 건',
        content:
          '2026년 4월 25일(토) 수원 ACME 스튜디오에서 개최하며, 2025년도 결산·감사 보고, 2026년도 사업 계획·예산안 승인, 이사 사임 추인 및 신임 이사(박재현, 유호강) 선출 등 법정 안건을 정리한다. 총회 안건 처리 후 네트워킹 파티·뒤풀이 기획과 회의 자료 준비, 다과·주류, 공간 세팅 담당자 지정 등 역할 분담을 논의한다. (안건지 사전 검토 안건)',
        status: 'proposed',
      },
    ],
  },
]

let inserted = 0
let skipped = 0
for (const m of meetings) {
  const { data: existing, error: exErr } = await db
    .from('board_meetings')
    .select('id')
    .eq('title', m.label)
    .eq('meeting_date', m.date)
    .maybeSingle()
  if (exErr) {
    console.error(`[${m.label}] 중복 조회 실패:`, exErr.message)
    process.exit(1)
  }
  if (existing) {
    console.log(`[skip] ${m.label} (${m.date}) 이미 존재`)
    skipped++
    continue
  }

  const createdAt = `${m.date}T21:00:00+09:00`
  const { data: meeting, error: mErr } = await db
    .from('board_meetings')
    .insert({
      title: m.label,
      meeting_date: m.date,
      location: m.location,
      status: 'completed',
      created_at: createdAt,
    })
    .select('id')
    .single()
  if (mErr || !meeting) {
    console.error(`[${m.label}] 회의 insert 실패:`, mErr?.message)
    process.exit(1)
  }

  const content = readFileSync(path.join(DOCS, m.source_file), 'utf8')
  const { error: minErr } = await db
    .from('board_minutes')
    .insert({ meeting_id: meeting.id, content, content_format: 'markdown' })
  if (minErr) {
    console.error(`[${m.label}] 회의록 insert 실패:`, minErr.message)
    process.exit(1)
  }

  const rows = m.agendas.map((a, i) => ({
    meeting_id: meeting.id,
    title: a.title,
    content: a.content,
    sort_order: i,
    status: a.status,
  }))
  const { error: agErr } = await db.from('board_agendas').insert(rows)
  if (agErr) {
    console.error(`[${m.label}] 안건 insert 실패:`, agErr.message)
    process.exit(1)
  }

  console.log(`[ok] ${m.label} (${m.date}) — 안건 ${rows.length}건`)
  inserted++
}

console.log(`\n완료: ${inserted}건 입력, ${skipped}건 스킵 (총 ${meetings.length})`)
