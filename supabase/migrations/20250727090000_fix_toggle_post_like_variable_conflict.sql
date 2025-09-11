-- Fix toggle_post_like function - resolve variable naming conflict
-- PostgreSQL error 42702: column reference "like_count" is ambiguous
-- The issue is that we have both posts.like_count column and a variable named current_like_count
-- which conflicts when referenced as just "like_count"

CREATE OR REPLACE FUNCTION toggle_post_like(
  p_post_id UUID,
  p_user_id UUID
) 
RETURNS TABLE(
  liked BOOLEAN,
  like_count INTEGER
) AS $$
DECLARE
  existing_like_id UUID;
  v_final_like_count INTEGER;
  v_is_liked BOOLEAN := false;
BEGIN
  -- Check if like already exists
  SELECT id INTO existing_like_id
  FROM post_likes
  WHERE post_id = p_post_id AND user_id = p_user_id;

  IF existing_like_id IS NOT NULL THEN
    -- Remove like
    DELETE FROM post_likes WHERE id = existing_like_id;
    v_is_liked := false;
  ELSE
    -- Add like
    INSERT INTO post_likes (post_id, user_id, created_at)
    VALUES (p_post_id, p_user_id, NOW());
    v_is_liked := true;
  END IF;

  -- Update post like_count and get the new count
  -- Use explicit table prefix to avoid ambiguity
  UPDATE posts 
  SET like_count = (
    SELECT COUNT(*) 
    FROM post_likes 
    WHERE post_likes.post_id = p_post_id
  )
  WHERE posts.id = p_post_id
  RETURNING posts.like_count INTO v_final_like_count;

  -- Return the result
  RETURN QUERY SELECT v_is_liked, v_final_like_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

