-- Keyset pagination function for post comments
create or replace function public.get_post_comments_keyset(
  p_post_id uuid,
  p_created_at timestamptz default null,
  p_id uuid default null,
  p_limit integer default 30
) returns setof comments
language sql
security definer
as $$
  select c.*
  from comments c
  where c.post_id = p_post_id
    and (
      p_created_at is null or
      c.created_at > p_created_at or (c.created_at = p_created_at and c.id > p_id)
    )
  order by c.created_at asc, c.id asc
  limit p_limit;
$$;

comment on function public.get_post_comments_keyset(uuid, timestamptz, uuid, integer)
is 'Keyset pagination for comments by (created_at, id).';

grant execute on function public.get_post_comments_keyset(uuid, timestamptz, uuid, integer) to anon, authenticated;

