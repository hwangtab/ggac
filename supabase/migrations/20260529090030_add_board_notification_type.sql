-- 이사회 알림용 타입 추가. ADD VALUE는 트랜잭션 밖에서 단독 실행.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'board_notice';
