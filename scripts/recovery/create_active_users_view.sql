-- Create active_users_view if missing (used by admin real-time monitor)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('v','m') AND n.nspname='public' AND c.relname='active_users_view'
  ) THEN
    EXECUTE '
      CREATE VIEW public.active_users_view AS
      SELECT 
        us.user_id,
        mp.display_name,
        mp.email,
        us.last_activity,
        us.ip_address,
        COUNT(ua.id) AS activity_count_today,
        us.session_token,
        EXTRACT(EPOCH FROM (NOW() - us.last_activity)) / 60 AS minutes_since_activity
      FROM user_sessions us
      JOIN member_profiles mp ON us.user_id = mp.id
      LEFT JOIN user_activities ua ON ua.user_id = us.user_id 
        AND ua.created_at >= CURRENT_DATE
      WHERE us.is_active = TRUE 
        AND us.last_activity > NOW() - INTERVAL ''30 minutes''
      GROUP BY us.user_id, mp.display_name, mp.email, us.last_activity, 
               us.ip_address, us.session_token
      ORDER BY us.last_activity DESC;
    ';
  END IF;
END$$;

-- Grant read access to authenticated (RLS applies to underlying tables)
GRANT SELECT ON public.active_users_view TO authenticated;
