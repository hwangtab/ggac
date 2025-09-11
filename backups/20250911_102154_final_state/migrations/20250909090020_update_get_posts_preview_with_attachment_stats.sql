-- Update function to include attachment statistics per post
create or replace function public.get_posts_preview(p_category text default '전체', p_limit int default 20)
returns table (
  id uuid,
  title text,
  content_preview text,
  content_format text,
  category text,
  author_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  is_pinned boolean,
  like_count integer,
  author_display_name text,
  total_attachments int,
  image_count int,
  document_count int,
  video_count int,
  audio_count int
) language sql stable as $$
  with base as (
    select
      p.id,
      p.title,
      left(regexp_replace(coalesce(p.content, ''), '<[^>]*>', '', 'g'), 150) as content_preview,
      p.content_format,
      p.category,
      p.author_id,
      p.created_at,
      p.updated_at,
      coalesce(p.is_pinned, false) as is_pinned,
      coalesce(p.like_count, 0) as like_count,
      mp.display_name as author_display_name
    from public.posts p
    left join public.member_profiles mp on mp.id = p.author_id
    where coalesce(p.is_deleted, false) is false
      and (p_category = '전체' or p.category = p_category)
  ), agg as (
    select
      b.*,
      coalesce(count(a.*), 0) as total_attachments,
      coalesce(count(*) filter (where a.file_type = 'image'), 0) as image_count,
      coalesce(count(*) filter (where a.file_type = 'document'), 0) as document_count,
      coalesce(count(*) filter (where a.file_type = 'video'), 0) as video_count,
      coalesce(count(*) filter (where a.file_type = 'audio'), 0) as audio_count
    from base b
    left join public.post_attachments a on a.post_id = b.id
    group by
      b.id, b.title, b.content_preview, b.content_format, b.category,
      b.author_id, b.created_at, b.updated_at, b.is_pinned, b.like_count, b.author_display_name
  )
  select * from agg
  order by is_pinned desc, created_at desc, id desc
  limit greatest(p_limit, 1);
$$;

comment on function public.get_posts_preview(text, int)
  is 'Return lightweight post list with preview and attachment counts.';

