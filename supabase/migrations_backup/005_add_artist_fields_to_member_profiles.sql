-- Add artist-related fields to member_profiles table
-- This migration extends the member_profiles table to support artist management

BEGIN;

-- Add artist-related columns to member_profiles
ALTER TABLE public.member_profiles 
ADD COLUMN IF NOT EXISTS artist_id TEXT,
ADD COLUMN IF NOT EXISTS is_artist BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS artist_role TEXT DEFAULT 'owner';

-- Add check constraint for artist_role (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_artist_role' 
      AND conrelid = 'public.member_profiles'::regclass
  ) THEN
    ALTER TABLE public.member_profiles 
    ADD CONSTRAINT check_artist_role 
    CHECK (artist_role IN ('owner', 'manager', 'collaborator'));
  END IF;
END$$;

-- Add index for artist_id for performance
CREATE INDEX IF NOT EXISTS idx_member_profiles_artist_id 
ON public.member_profiles (artist_id);

-- Add index for is_artist for performance
CREATE INDEX IF NOT EXISTS idx_member_profiles_is_artist 
ON public.member_profiles (is_artist);

-- Create artists table to store artist information
CREATE TABLE IF NOT EXISTS public.artists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  legacy_id TEXT UNIQUE NOT NULL, -- 기존 artist-001 형태 ID
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT[],
  profile_image TEXT,
  one_liner TEXT,
  bio TEXT,
  template_type TEXT DEFAULT '콜라주형',
  portfolio_links JSONB DEFAULT '[]'::jsonb,
  youtube_videos JSONB DEFAULT '[]'::jsonb,
  contact TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add check constraint for template_type (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_template_type' 
      AND conrelid = 'public.artists'::regclass
  ) THEN
    ALTER TABLE public.artists 
    ADD CONSTRAINT check_template_type 
    CHECK (template_type IN ('미니멀형', '콜라주형'));
  END IF;
END$$;

-- Add indexes for artists table
CREATE INDEX IF NOT EXISTS idx_artists_legacy_id ON public.artists (legacy_id);
CREATE INDEX IF NOT EXISTS idx_artists_slug ON public.artists (slug);
CREATE INDEX IF NOT EXISTS idx_artists_name ON public.artists (name);

-- Add foreign key constraint (soft reference, no cascading)
-- We're not adding a hard foreign key constraint to allow flexibility
-- The application will handle the relationship validation

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for artists table
-- Create trigger (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_artists_updated_at'
      AND tgrelid = 'public.artists'::regclass
  ) THEN
    CREATE TRIGGER update_artists_updated_at
        BEFORE UPDATE ON public.artists
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END$$;

-- Enable RLS on artists table
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

-- RLS Policies for artists table

-- Policy: Anyone can view artists (public information)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='artists' AND policyname='Anyone can view artists'
  ) THEN
    CREATE POLICY "Anyone can view artists" ON public.artists
        FOR SELECT USING (true);
  END IF;
END$$;

-- Policy: Connected members can update their artist profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='artists' AND policyname='Members can update their artist profile'
  ) THEN
    CREATE POLICY "Members can update their artist profile" ON public.artists
        FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE mp.id = auth.uid()
            AND mp.artist_id = artists.legacy_id
            AND mp.is_artist = true
            AND mp.is_active = true
            AND mp.registration_status = 'approved'
        )
    );
  END IF;
END$$;

-- Policy: Admins can update all artists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='artists' AND policyname='Admins can update all artists'
  ) THEN
    CREATE POLICY "Admins can update all artists" ON public.artists
        FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE mp.id = auth.uid()
            AND mp.is_admin = true
            AND mp.is_active = true
            AND mp.registration_status = 'approved'
        )
    );
  END IF;
END$$;

-- Policy: Connected members can insert new artist records (for future use)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='artists' AND policyname='Members can insert their artist profile'
  ) THEN
    CREATE POLICY "Members can insert their artist profile" ON public.artists
        FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE mp.id = auth.uid()
            AND mp.is_artist = true
            AND mp.is_active = true
            AND mp.registration_status = 'approved'
        )
    );
  END IF;
END$$;

-- Policy: Only admins can delete artists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='artists' AND policyname='Only admins can delete artists'
  ) THEN
    CREATE POLICY "Only admins can delete artists" ON public.artists
        FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE mp.id = auth.uid()
            AND mp.is_admin = true
            AND mp.is_active = true
            AND mp.registration_status = 'approved'
        )
    );
  END IF;
END$$;

-- Insert initial artist data from JSON (this would be done manually or via script)
-- This is commented out as it should be done after the application is ready
/*
INSERT INTO public.artists (legacy_id, slug, name, category, profile_image, one_liner, bio, template_type, portfolio_links, youtube_videos, contact)
VALUES 
  ('artist-001', 'sabbaha', '사바하', ARRAY['창작자', '기획자'], '/images/artists/choi-hee-chul.webp', '슬러지에서 기어 올라온 하이게인 둠 거인으로 운명을 뒤트는 고통을 표현합니다.', '...', '미니멀형', '...', '...', 'sabbaha.doom@gmail.com'),
  -- ... other artists
  ;
*/

-- Create view for easier artist-member relationship queries
CREATE OR REPLACE VIEW public.artist_members AS
SELECT 
    a.id as artist_uuid,
    a.legacy_id as artist_id,
    a.slug,
    a.name as artist_name,
    mp.id as member_id,
    mp.display_name as member_name,
    mp.artist_role,
    mp.is_active as member_active,
    mp.registration_status
FROM public.artists a
LEFT JOIN public.member_profiles mp ON a.legacy_id = mp.artist_id
WHERE mp.is_artist = true;

-- Grant permissions for the view
GRANT SELECT ON public.artist_members TO authenticated;

-- Create function to get artist by member ID
CREATE OR REPLACE FUNCTION public.get_artist_by_member_id(member_uuid UUID)
RETURNS TABLE (
    artist_id UUID,
    legacy_id TEXT,
    slug TEXT,
    name TEXT,
    category TEXT[],
    profile_image TEXT,
    one_liner TEXT,
    bio TEXT,
    template_type TEXT,
    portfolio_links JSONB,
    youtube_videos JSONB,
    contact TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.legacy_id,
        a.slug,
        a.name,
        a.category,
        a.profile_image,
        a.one_liner,
        a.bio,
        a.template_type,
        a.portfolio_links,
        a.youtube_videos,
        a.contact,
        a.created_at,
        a.updated_at
    FROM public.artists a
    JOIN public.member_profiles mp ON a.legacy_id = mp.artist_id
    WHERE mp.id = member_uuid 
    AND mp.is_artist = true 
    AND mp.is_active = true
    AND mp.registration_status = 'approved';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.get_artist_by_member_id TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE public.artists IS 'Artist profiles and information';
COMMENT ON COLUMN public.member_profiles.artist_id IS 'Reference to artist legacy_id if member is an artist';
COMMENT ON COLUMN public.member_profiles.is_artist IS 'Whether this member is an artist';
COMMENT ON COLUMN public.member_profiles.artist_role IS 'Role of the member for the artist profile (owner, manager, collaborator)';

COMMIT;
