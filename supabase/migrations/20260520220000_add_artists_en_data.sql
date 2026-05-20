-- SQL Migration: Add English data to artists table
-- Generated: 2026-05-20
-- This migration adds English translations for existing artists

-- Add English columns to artists table
ALTER TABLE artists ADD COLUMN IF NOT EXISTS name_en TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS bio_en TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS one_liner_en TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS template_type_en TEXT;

-- Update artists with English data
UPDATE artists SET
  name_en = 'Sabbaha',
  bio_en = $$$Chairperson of the Gyeonggi Art Collective Cooperative. A drone metal-sludge-free improvisation duo based in Seoul. A high-gain doom giant crawled out of the sludge, expressing the pain of twisting fate. Sabbaha''s music is characterized by doom metal — featuring extremely slow, heavy sound — layered with elements of drone music that emphasize sustained low frequencies and tonal texture.\n\n### Music Genres\n- Pseudo-Occult Doom Drone\n- Doom Metal$$$,
  one_liner_en = 'A high-gain doom giant crawled out of the sludge, expressing the pain of twisting fate.',
  template_type_en = 'minimal'
WHERE slug = 'sabbaha';

UPDATE artists SET
  name_en = 'themilliways',
  bio_en = $$$themilliways (the milliways) is a solo project by musician Ju Jintae, pursuing emotional yet experimental soundscapes rooted in ambient and post-rock.\n\n### Musical Beginnings\n\nHaving begun composing in the early 2000s, he was drawn to music through the influence of raw, rough sounds from bands like Nirvana and Sonic Youth. With an interest in social movements and resistance culture, he also served as the inaugural secretary-general in the founding of ''Korea Information & Communication Workers'' Union,'' the first sector-based IT union in Korea.\n\n### Band Activity and Social Engagement\n\nIn 2007, he co-founded Munggu Band and debuted as guitarist at the Salsal Festival protesting the Saemangeum reclamation project. Until 2014, he conveyed messages of resistance through punk rock at various protest sites — labor movement rallies, anti-war peace marches, and occupation sites resisting large-scale gentrification (especially Hongdae''s Duriban).\n\n### The Intersection of Media and Music\n\nFrom 2005 to 2015, he worked as a content producer and creative director at Seo Taiji Company, continually experimenting at the intersection of music and media.\n\n### A New Beginning\n\nFollowing a terminal lung cancer diagnosis in 2017, during the time of survival and recovery, he resolved to build his own musical world. As the start of a journey to rediscover his essence, on December 27, 2021, he released his first EP ''3rd air'' as the solo project themilliways, making his official debut.\n\n### Present\n\nSince then, he has released ''Void,'' ''Disappear,'' ''Ian EP,'' and more, continuing to expand his own musical world while steadily challenging experiments and crossovers that transcend genre boundaries.\n\n### Main Genres\n\n- Ambient Rock\n- Experimental Rock\n- Post Rock\n- Art Rock\n- Instrumental\n\n### Content Production\n- 2008 Seo Taiji 8th Atmos Part Moai teaser music composition\n- 2009 Seo Taiji 8th Atmos Part Secret teaser music composition\n- 2009-2013 Seo Taiji 8th album video content creative director\n- 2014-2015 Seo Taiji 9th album concert and content creative director\n\n### Music Activities\n- 2007-2015 Munggu Band guitarist\n- 2013 Manpasikjeok bassist\n- 2014 Pagoewang bassist\n- 2019 Hwang Boryeong Band SmackSoft 20th anniversary concert bass session\n\n### Solo Activities\n- 2021.12.27 Solo debut themilliways - 3rd air\n- 2024.07.07 Void single release\n- 2024.10.31 Special EP Ian release\n- 2024.12.08 Disappear single release\n- 2024.10.03 Mixtape Mavericks Market @ Longplayer Suwon performance\n- 2025.01.25 Impeachment Prayer Concert @ Bookcafe Manyuinryeok performance$$$,
  one_liner_en = 'Through time spent surviving and recovering, I build soundscapes that are both emotional and experimental.',
  template_type_en = 'collage'
WHERE slug = 'themilliways';

UPDATE artists SET
  name_en = 'Yoo Dong-hyuk',
  bio_en = $$$In my younger days I played in a punk rock band, lost a member, wandered, and lived with an acoustic guitar.\n\n### Musical Journey\n\nStarting from the energy of punk rock, he has passed through life''s turning points and found his own color in the unique genre of punk-folk. Music saturated with the pain of loss and the years of wandering, conveying a rough yet warm sensibility.\n\n### Main Genres\n\nPunk-Folk$$$,
  one_liner_en = 'From punk rock to punk-folk — unfolding a musical world found through loss and wandering.',
  template_type_en = 'minimal'
WHERE slug = 'yoo-dong-hyuk';

UPDATE artists SET
  name_en = 'Namsu',
  bio_en = $$$A versatile female solo artist presenting music that spans diverse genres including indie music, folk/blues, jazz, and new age.\n\n### Running a Cultural Space\n\nShe runs a cultural space called ''Ddakttaguri Bookshop,'' creating a meeting point between music and literature. Through this space, she provides special experiences where artists and audiences come together.\n\n### Artistic Expansion\n\nGoing forward, she aims to expand her artistic boundaries through work combining not only music but also visual art, performance, and various other art forms.\n\n### Main Genres\n\n- Indie Music\n- Folk\n- Blues\n- Jazz\n- New Age$$$,
  one_liner_en = 'A versatile artist who expands boundaries by combining music, literature, and various art forms.',
  template_type_en = 'minimal'
WHERE slug = 'namsu';

UPDATE artists SET
  name_en = 'Hwang Gyeong-ha',
  bio_en = $$$Active as a writer, musician, photographer, producer, and more across multiple fields, ready to play a role in the moments when those without power need it most. Moving with special attention to the moments when writing, music, photography, and other arts hold power in the field.\n\n### Musical Journey\n\nHe has built his own musical world crossing rock and folk. During his ''No Control'' band days, he drew attention with punk and alternative rock, and later focused on folk music, presenting songs that highlight lyricism and intimacy. His songs carry a critical awareness of the times and compassion for the socially marginalized.\n\n### Social Engagement and Solidarity\n\nThrough activities with the ''Self-Reliant Music Production Cooperative'' and ''Art Liberation Front,'' he has sought to promote musician independence and solidarity, and explored building an alternative music ecosystem that resists commercialism. He stands in solidarity with those who have lost their homes to redevelopment and gentrification, expressing their stories through artistic practices such as music and exhibitions.\n\n### Key Production Work\n\n- ''Takeout Drawing'' (2015) Producer\n- ''Gentrification'' (2016) Producer\n- ''Colt-Coltec Struggle 10th Anniversary Album'' (2017) Producer\n- ''New People''s Music Selection 1, 2, 3'' (2017-2018) Producer\n- ''Center of the Body'' (2019) Producer\n- ''Fish Die Without Water'' (2022) Producer\n- ''Tender Leaves'' (2024) Producer\n\n### Personal Work\n\n- ''Like Snow Melting'' (2024) Release\n- Ahyeon Pocha Cookbook (2017) Concept and writing\n- Exhibition ''Noryangjin — Land, City, People'' (2020) Planning\n\n### Awards\n\n- 2012 Daum Music Album of the Month (album ''No Control'')\n- 2015 Red Award, ''Notable Solidarity'' category\n- 2017 Red Award, ''Field'' category\n- 2017 Korean Popular Music Award Selection Committee Special Award\n- 2019 Red Award, ''Notable Solidarity'' category\n\n### Artistic Vision\n\nFor Hwang Gyeong-ha, art is not a tool for personal advancement but a means for social transformation. He pursues art that breathes with the field, art that stands with the people, and rather than chasing fame and wealth, practices art that empathizes with the pain of the times and stands in solidarity with the marginalized.$$$,
  one_liner_en = 'An all-around activist who stands in solidarity with the powerless through art that breathes with the field and art that stands with the people.',
  template_type_en = 'collage'
WHERE slug = 'hwang-gyeong-ha';

UPDATE artists SET
  name_en = 'Zsthyger',
  bio_en = $$$The only way to prove the worth of an instrument and its player is through performance.\n\n### ACME Studio\n\n- Coming soon\n\n### Main Genres\n\n- Electronic Music\n- Metal\n- Classical$$$,
  one_liner_en = 'I document a journey to convey what cannot be expressed in words.',
  template_type_en = 'collage'
WHERE slug = 'acmein';

UPDATE artists SET
  name_en = 'Jang Hyun-ho',
  bio_en = $$$Singer-songwriter Jang Hyun-ho is the central figure of Gilganeun Band, formed in 2011. He has written nearly all of the band''s lyrics and compositions himself, shaping Gilganeun Band''s musical direction and message.\nDrawing on the characteristics of a street-style band, he has consistently participated in sites of social struggle, standing in solidarity through song. At countless scenes including the Sewol ferry disaster, the Gangjeong village struggle against the Jeju Naval Base, and the KTX dismissed flight attendants'' reinstatement struggle, he raised social issues through music and played a role in awakening a sensitivity to peace.\nJang Hyun-ho''s songs carry a sincere desire to connect the marginalized with ordinary people and to comfort sites of pain. Songs such as ''75m Above'' and ''We Will Shine Again'' illustrate this musical philosophy well. Additionally, ''Seed Song,'' included on Gilganeun Band''s first full-length album, is the first song he ever wrote — encapsulating the reason the band sings — offering a glimpse into his musical beginnings and deep intentions.\nHe handles vocals and acoustic guitar, and beyond writing and composing for albums, participates in choruses as well, playing a central role across all aspects of music production. The unique sound of Gilganeun Band deeply reflects Jang Hyun-ho''s musical individuality.\nJang Hyun-ho is a core singer-songwriter who delivers social messages.\n\n### Music Genres\n- Folk\n- Rock$$$,
  one_liner_en = 'Jang Hyun-ho''s songs carry a sincere desire to connect the marginalized with ordinary people and to comfort sites of pain.',
  template_type_en = 'minimal'
WHERE slug = 'jang-hyun-ho';

UPDATE artists SET
  name_en = 'ANAZAO',
  bio_en = $$$Unfolding philosophical lyrics in the journey of seeking God.\n\n### Music Genres\n- Hip-Hop$$$,
  one_liner_en = 'Unfolding philosophical lyrics in the journey of seeking God.',
  template_type_en = 'minimal'
WHERE slug = 'anazao';

UPDATE artists SET
  name_en = 'Heewoo',
  bio_en = $$$Heewoo is an unparalleled vocalist and singer-songwriter. Presenting modern music rooted in traditional pansori vocal technique, he has built his own distinctive musical world.\nHeewoo''s music is characterized by sublimating the helplessness and unresolved problems he has personally experienced in life into art. His songs are a crossover genre utilizing pansori vocal technique, combining traditional melodies with a modern sensibility and experimental arrangements to convey both depth and novelty simultaneously. In particular, Heewoo''s voice expresses deep emotions such as the sorrow of parting in a calm yet restrained manner. Masterfully avoiding the exaggerated vocal embellishments of trot without falling into melodrama, he has a remarkable ability to deliver an aching, visceral pain to the listener. He also reinterprets the sounds of traditional instruments such as daegeum and gayageum in a modern context, evoking a sense of loss and bewilderment that transcends time.\nHeewoo combines the deep soul of traditional music with the innovative elements of contemporary music, active as a distinctive artist drawing attention in the indie music scene.\n\n### Music Genres\n- Folk\n- Pansori$$$,
  one_liner_en = 'Presenting modern music rooted in traditional pansori vocal technique, building a distinctive musical world all his own.',
  template_type_en = 'collage'
WHERE slug = 'heewoo';

UPDATE artists SET
  name_en = 'Meridies',
  bio_en = $$$Meridies''s music — which contains the vague anxiety of ideals and chaotic phrases within tightly woven music — is like a well-crafted blueprint.\n\n### Music Genres\n- Death Metal\n- Symphonic Black Metal$$$,
  one_liner_en = 'Meridies''s music contains the vague anxiety of ideals and chaotic phrases within tightly woven music — like a well-crafted blueprint.',
  template_type_en = 'collage'
WHERE slug = 'Meridies';

UPDATE artists SET
  name_en = 'Pepperman',
  bio_en = $$$Pepperman (real name: Yoo Ho-gang) has been active as a metal/hardcore artist since founding UMD (Umandog Metal Corps) in 2024.\n\n### Musical Journey\n\nThrough the metal/hardcore music life of a lazy person cursed to never be able to stand boredom, he is active on various club stages in Seoul and Gyeonggi together with UMD. Continuing collaborations with prominent metal bands such as Sabbaha, Panzerkorps, and Meridies, he is establishing himself as a notable newcomer in the Korean metal scene.\n\n### Key Activities\n\nSince founding UMD in 2024, he has participated in numerous Seoul and Gyeonggi club performances and also took part in the MMC Iron Man Special. He also participated in the 1st installment of ''Barbed Wire: METAL SYNDICATE NETWORK'' held in Suwon with UMD, contributing to the building of the Gyeonggi local metal scene network.\n\nHe is currently forming a separate grindcore band, preparing toward an end-of-year release, and continues to broaden his musical spectrum across more diverse metal genres.\n\n### Music Genres\n- Metal\n- Hardcore\n- Grindcore$$$,
  one_liner_en = 'The late metal/hardcore music life of a lazy person cursed to never be able to stand boredom',
  template_type_en = 'collage'
WHERE slug = 'pepperman';

UPDATE artists SET
  name_en = 'Blackgoat',
  bio_en = $$$Blackgoat is an artist who draws out human instinct and emotion directly through a rough and primal sound, while simultaneously unraveling it with a fervent, aestheticist sensibility reminiscent of a youth manga.\n\n### Musical World\n\nRooted in the influences of punk, garage, and blues, yet not bound to any specific genre. In particular, his music persistently digs into the emotions and tragedies of those standing outside society''s boundaries — outsiders who don''t belong anywhere — and at times depicts them with a cruelty that is beautiful.\n\n### Artistic Sensibility\n\nWithin his world built of violence and cynicism, strange humor, and a twisted romanticism, Blackgoat reveals unadorned beauty in the most raw manner.\n\n### Music Genres\n- Punk\n- Garage\n- Blues$$$,
  one_liner_en = 'An artist who depicts the tragedy of outsiders with a raw and primal sound — cruelly yet beautifully.',
  template_type_en = 'minimal'
WHERE slug = 'blackgoat';

UPDATE artists SET
  name_en = 'Golbang Lady',
  bio_en = $$$Golbang Lady is an artist who draws out the emotions of the closet with the utmost honesty.\n\n### Musical World\n\nThe rough breath of punk that confronts loneliness head-on, and the sticky emotions of golbang soul blooming within a narrow room, flow simultaneously. She unravels through music the emotions drawn from the most private spaces — not glamorous, but real.\n\n### Keywords\n- Golbang Soul\n- Lonely Punk\n- A Lady Rooted in the Closet$$$,
  one_liner_en = 'A lady rooted in the closet, golbang soul, lonely punk',
  template_type_en = 'minimal'
WHERE slug = 'golbang-lady';

UPDATE artists SET
  name_en = 'Harris',
  bio_en = $$$Harris is a name that originated from an interest in Irish and Scottish Celtic culture, but it is also a name that has existed with similar pronunciation in Greece, the Middle East, and India throughout the flow of history. Particularly in the Middle East and India, it is a common name given to boys, carrying the meaning of **guardian, protector**.\n\n### Artistic Vision\n\nI want to be a person who emits good light to protect those who are in pain, and creates a path to soothe their hearts through music.\n\n### Musical World\n\nI believe folk music is the culture that most honestly reveals the way people in a society live. For that reason, I have a deep interest in the folk music of various countries, and am drawing the textures of diverse traditional music into my own work.\n\n### What I Want to Do\n\n**Folklore** — I want to become a storyteller who captures our stories and expresses them through song.\n\n### Keywords\n- Folk Music (Folklore)\n- Celtic, Middle Eastern, and Indian Traditions\n- Guardian\n- Storyteller$$$,
  one_liner_en = 'An artist who wants to become a storyteller singing our stories through the folk music of various countries',
  template_type_en = 'minimal'
WHERE slug = 'harris';

-- Verify updates
SELECT slug, name, name_en, one_liner_en FROM artists ORDER BY slug;
