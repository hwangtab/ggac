/**
 * 《HWA》 EP 프레스킷 문안.
 *
 * 데이터만 둔다. 렌더링은 page.tsx가 한다.
 * 여기 적힌 사실은 전부 docs 스펙의 사실 원장
 * (docs/2026-09-01-hwa-outreach-design.md §1)에서 온 것이다. 새 사실을 여기서
 * 만들지 않는다.
 *
 * 영문 문안은 장재원 평론의 번역이 아니라 별도 집필이다. 평론은 국내 독자에게
 * 쓴 글이고, 프레스릴리스와 평론은 장르가 다르다. 평론은 한국어판 lede에
 * 인용으로 살렸다.
 */
export type PressContent = {
  title: string
  subtitle: string
  releaseLine: string
  lede: string[]
  quote: { text: string; source: string; url: string }
  facts: [string, string][]
  credits: [string, string][]
  bio: string[]
  downloads: { label: string; url: string; note?: string }[]
  factsHeading: string
  bioHeading: string
  lyricsHeading: string
  contactHeading: string
  contactBody: string
}

/** 트랙과 스트리밍은 언어에 따라 달라지지 않으므로 PressContent 밖에 둔다. */
export const TRACKS = [
  { n: 1, title: 'September Theater', length: '1:13' },
  { n: 2, title: 'Past Self', length: '1:05' },
  { n: 3, title: 'Violent Disgust', length: '1:02' },
  { n: 4, title: 'Hollow Face', length: '1:45' },
  { n: 5, title: 'Letter to Jane Doe', length: '0:53' },
  { n: 6, title: 'Hymn for the Night', length: '1:04' },
  { n: 7, title: 'Irreversible Imprint', length: '1:21' },
  { n: 8, title: 'Decomposition', length: '2:07' },
]

export const STREAMING: [string, string][] = [
  ['Spotify', 'https://open.spotify.com/album/6vcAuVZzlBTEOQEGU7oSAx'],
  ['Apple Music', 'https://music.apple.com/kr/album/hwa/6801438072'],
  ['Bandcamp', 'https://hwagrind.bandcamp.com'],
]

/**
 * 자산 URL.
 *
 * 2026-09-01 업로드 완료. 세 URL 모두 HEAD 200과 content-type을 확인했다.
 *
 * 경로를 바꾸지 마라 — 이 주소가 기자들에게 나가는 메일에 그대로 박힌다.
 * 자산을 갈아 끼울 때도 같은 경로에 덮어쓴다(addRandomSuffix: false).
 */
export const ASSETS = {
  zip: 'https://r8qnr9c7mestxusj.public.blob.vercel-storage.com/press/hwa/hwa-ep-mp3.zip',
  artwork: 'https://r8qnr9c7mestxusj.public.blob.vercel-storage.com/press/hwa/artwork.jpg',
  photo: 'https://r8qnr9c7mestxusj.public.blob.vercel-storage.com/press/hwa/photo.jpg',
}

/**
 * 가사 전문. 키는 트랙 번호다.
 *
 * 밴드가 쓴 그대로 둔다 — 오타(inmemorable, selfinshness, pilled)도 고치지
 * 않는다. 고치려면 밴드에게 묻는다.
 */
export const LYRICS: Record<number, string> = {
  1: `Descending into the void
Color of a fall
I keep recollecting
The very last feeble sunlight

Live in vain
Endlessly while the dream starts rotting
The endless hope
I’m drowning in the pool of despair
And sleep with my sorrow

The autumn blooms with another sunrise
Weeping endless scar deep in my lungs

Chattering thoughtlessly with a scarlet voice
Drunk in inmemorable illusion

Infinite glaze of spear keep watching me
The point of my weakness singing deadly

September Theatre
Withering away
And all went quiet`,
  2: `No dream Nothing No one left in this cruel world
You are just pathetic one

Everything goes senseless
Feeling doesn’t exist
You left behind again
Chewing your idle past

You selfish mankind Are walking out on yet
No tears left to drown in the ocean of lone

Blaming yourself not to blame other ones
Get used to be dumped
It was my life my fate

Another comes and another goes and
I still left like a piece of fucking trash

No more laugh no more weep are in my vain life`,
  3: `In front of mirror of brutal truth looking back myself
Nothing can reflect my obscene disgusting smile
Filthy exquisite limbs sophisticated face
Mixed up messily and lay down 6 feet under

Self loathing self hatred floating on violet cloud
I who lost way in black cavern wandering around
Never saw my face when you are holding me in your arm
But I know it would be nauseous and vacant`,
  4: `Loneliness sucks a wide blue wave
Emptiness swallows us to hollow cavern
Aloofness blew right past the air
“Witness me,” everyone said with vain words

Faceless soul stuck out like a grave
An useless smile hung on people’s tongue
A dreamless hope clung to winter’s night
Endless cry that no one cares at all`,
  5: `Cover of the transience are pilled by the wind
As the time goes by calluses are fade away

Bittersweet memories of a human life
Washed away with a glass of wine

Dancing in the unspoken truth of another sweet lies
Not for me but not every word has its own meanings

A night comes and the other night comes
Promises are spoken and yet forgotten
No human knows the real face of themselves
No one knows their real smile and their cry`,
  6: `Nighttime comes and all falls down here
I dreamed of a dream of me
No subtle issues that i should care
It only remains in unconscious life

Velvet hallucination is grounding in my toxic soul
I cried in black womb of truth
The sweet delusion of endless torture

Immolation of human life
Everytime i feel the truth i crave death

Nauseous but still beautiful
That's how our life comes and goes back and forth

Vague moon comforts wandering essence
I dream of my death eternally`,
  7: `Bleach my sinful memory with a knife
Desolate landscape compiles cold winter breeze
Pale white soul whimpers faintly
Front of me
Trying to castrate my mind

Red Scarlet Vertical scar
Draws a painful art On my flesh
I Still Don’t Know that
Which is the truth or Which is the lie

Transient Like a  Morning dew
Spitting the last word that I Didn’t mean at all
Down in the dumps
A black dog
Laughs At Mindful selfinshness

Recollection of my Affliction
Pain Carved In my chest and flesh
Hades calls me now and I should have crossed the River Of Lethe

Oblivion of the true self
I Stuck in The sweet lies
Hit rock bottom
No strength to tame me
I’m Here Alone`,
  8: `Flower withers in the cold while the tree decays
Among those vibrant memories you’re fading out

I cannot dream you anymore
Spell you anymore
Looking back at my colorful times
Vanity only remains now

When the sanity in my life gradually fading away
I finally realized it there is no eternity
Candy-coated pledge of love is the empty promises
You finally left my world leaving me behind`,
}

export const PRESS_EN: PressContent = {
  title: 'HWA',
  subtitle: 'Debut EP · 8 tracks · 10 minutes 30 seconds',
  releaseLine: 'Out August 21, 2026',
  lede: [
    'Gene Meyer gave his December 2, 2025 Blast Worship column — Decibel’s showcase for emerging grindcore bands — over to HWA and wrote of the band’s Demo 2025: “Demo of the year in my humble opinion.” This EP is where those songs arrive finished. Four of them — “September Theater,” “Past Self,” “Hollow Face” and “Letter to Jane Doe” — are re-recorded here, and the record runs to eight tracks in all.',
    'The whole thing is eight tracks and ten minutes thirty seconds. The band describes what it plays as blast-beat-driven drums, merciless guitar and very high screams with melodic, emotional riffs laid over them — grindcore that is fast and ferocious and beautiful at once — and names Discordance Axis, Gridlink, Barren Path, Vektor and Cloud Rat as its reference points.',
    'The lyrics are in English throughout, written by vocalist JK. HWA says it sets out to put the hurt, loneliness, misanthropy, self-loathing and emptiness that come out of human relationships down raw, without dressing them up. The full text of all eight songs is on this page.',
  ],
  quote: {
    text: 'Demo of the year in my humble opinion.',
    source: 'Gene Meyer, Decibel — "Blast Worship: HWA" (December 2, 2025)',
    url: 'https://www.decibelmagazine.com/2025/12/02/blast-worship-hwa/',
  },
  facts: [
    ['Release', 'August 21, 2026'],
    ['Format', 'Digital EP'],
    ['Length', '8 tracks · 10:30'],
    ['Genre', 'Grindcore'],
    ['Lineup', 'JK (vocals) · OCheolWang (guitars, bass) · GopChang (drums)'],
    ['From', 'Seoul, South Korea'],
  ],
  credits: [
    ['Vocals, Lyrics', 'JK'],
    ['Guitars, Bass', 'OCheolWang'],
    ['Drums', 'GopChang'],
    ['Composed by', 'OCheolWang, except "Irreversible Imprint" (GopChang)'],
    ['Arranged by', 'HWA'],
    ['Recorded by', 'Lee Jinwoo at Spot Sound'],
    ['Mixed and mastered by', 'HoKang Yu (Pepperman)'],
    ['Artwork', 'JK'],
    ['Photo', 'Jung Wootaek'],
  ],
  bio: [
    'HWA formed in Seoul in September 2024 as a two-piece: OCheolWang on guitars and bass, GopChang on drums. Vocalist JK joined in 2025, completing the current three-piece lineup.',
    'The band put out Demo 2025 on October 30, 2025. Decibel covered it in Blast Worship on December 2, 2025. In 2026, HWA released a split with the Korean grindcore band Naiite, 《Hwa // Naiite》, through Vanilla Thunder Records.',
    '《HWA》, out August 21, 2026, is the band’s first EP.',
  ],
  downloads: [
    {
      label: 'Full EP — 8 tracks, MP3 320kbps (ZIP)',
      url: ASSETS.zip,
      note: '10:30 total',
    },
    {
      label: 'Cover artwork — high resolution (JPG)',
      url: ASSETS.artwork,
      note: 'Artwork by JK',
    },
    {
      label: 'Band photo — high resolution (JPG)',
      url: ASSETS.photo,
      note: 'Photo by Jung Wootaek — please credit',
    },
  ],
  factsHeading: 'The facts',
  bioHeading: 'About HWA',
  lyricsHeading: 'Lyrics',
  contactHeading: 'Contact',
  contactBody:
    'For interviews, WAV masters or anything else you need, write to contact@ggac.kr. Please credit photographs to Jung Wootaek.',
}

export const PRESS_KO: PressContent = {
  title: '화 (HWA)',
  subtitle: '첫 EP · 8곡 · 10분 30초',
  releaseLine: '2026년 8월 21일 발매',
  lede: [
    '2025년 12월 2일, 익스트림 메탈 잡지 Decibel의 Gene Meyer는 신흥 그라인드코어 밴드를 소개하는 「Blast Worship」 코너에 HWA를 올리며 Demo 2025를 두고 “Demo of the year in my humble opinion”이라고 썼다. 그 데모에 실렸던 네 곡 「September Theater」·「Past Self」·「Hollow Face」·「Letter to Jane Doe」는 이번 EP에 재녹음돼 실렸고, 여기에 네 곡이 더해져 모두 여덟 곡이 됐다.',
    '8곡 전체가 10분 30초다. 밴드는 Discordance Axis, Gridlink, Barren Path, Vektor, Cloud Rat을 참조점으로 밝혔다.',
    '음악평론가 장재원은 이 앨범을 두고 이렇게 썼다. “기존의 다른 그라인드코어 밴드들이 ‘텍스쳐’보다는 장르 특유의 ‘감정’에 중시하여 듣는 이 자체를 ‘그저 분노에 표출해 머리를 흔들며 벽에다 주먹질을 하는’ 무지막지한 단세포 동물로 만들었다면, 이 HWA의 음악은 그렇게 화난 이들을 의자에 끌어다 앉힌 후 ‘수준높은 분노’를 듣는 이에게 선사한다.”',
    '“그라인드코어에서 음악의 텍스쳐로 진지한 고찰을 하게 만든 앨범이 우리나라에 몇 개나 있던가?” — 음악평론가 장재원',
    '가사는 전곡 영어다. 밴드는 인간관계에서 느낀 상처와 외로움, 인간혐오, 자괴감, 공허감을 날것 그대로 표현한다고 밝혔다. 전곡 가사 전문을 이 페이지에 실었다.',
  ],
  quote: {
    text: 'Demo of the year in my humble opinion.',
    source: 'Gene Meyer, Decibel 「Blast Worship: HWA」 (2025년 12월 2일) — Demo 2025에 대해',
    url: 'https://www.decibelmagazine.com/2025/12/02/blast-worship-hwa/',
  },
  facts: [
    ['발매', '2026년 8월 21일'],
    ['포맷', '디지털 EP'],
    ['구성', '8곡 · 10분 30초'],
    ['장르', '그라인드코어'],
    ['편성', 'JK (보컬) · OCheolWang (기타, 베이스) · GopChang (드럼)'],
    ['활동 지역', '대한민국 서울'],
  ],
  credits: [
    ['보컬, 작사', 'JK'],
    ['기타, 베이스', 'OCheolWang'],
    ['드럼', 'GopChang'],
    ['작곡', 'OCheolWang — 「Irreversible Imprint」만 GopChang'],
    ['편곡', 'HWA'],
    ['녹음', '이진우 (Spot Sound)'],
    ['믹싱·마스터링', '유호강 (Pepperman)'],
    ['아트워크', 'JK'],
    ['사진', '정우택'],
  ],
  bio: [
    'HWA는 2024년 9월 서울에서 결성됐다. 처음에는 기타와 베이스를 맡은 OCheolWang, 드럼을 맡은 GopChang 둘이었고, 보컬 JK가 2025년에 합류하면서 지금의 3인조가 됐다.',
    '2025년 10월 30일 Demo 2025를 냈고, 2025년 12월 2일 Decibel의 「Blast Worship」이 이를 다뤘다. 2026년에는 한국 그라인드코어 밴드 Naiite와의 스플릿 《Hwa // Naiite》를 Vanilla Thunder Records를 통해 발매했다.',
    '2026년 8월 21일에 나온 《HWA》가 밴드의 첫 EP다.',
  ],
  downloads: [
    {
      label: '전곡 8곡 — MP3 320kbps (ZIP)',
      url: ASSETS.zip,
      note: '총 10분 30초',
    },
    {
      label: '앨범 아트워크 — 고해상도 (JPG)',
      url: ASSETS.artwork,
      note: 'Artwork by JK',
    },
    {
      label: '프로필 사진 — 고해상도 (JPG)',
      url: ASSETS.photo,
      note: '사진 정우택 — 반드시 크레딧을 밝혀주세요',
    },
  ],
  factsHeading: '기본 정보',
  bioHeading: '밴드 소개',
  lyricsHeading: '가사',
  contactHeading: '연락처',
  contactBody:
    '인터뷰·WAV 원본·추가 자료 문의는 contact@ggac.kr로 주세요. 사진을 쓸 때는 촬영 정우택을 밝혀주세요.',
}
