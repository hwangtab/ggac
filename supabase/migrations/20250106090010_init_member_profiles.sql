-- supabase/migrations/20250707_init_member_profiles.sql

-- Drop existing tables and functions to ensure a clean slate
DROP TABLE IF EXISTS public.comments CASCADE;
DROP TABLE IF EXISTS public.posts CASCADE;
DROP TABLE IF EXISTS public.member_profiles CASCADE;

-- Drop existing functions and triggers if they exist to avoid conflicts
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

-- Create member_profiles table with full schema from docs/ggac_board_plan_v2.md
CREATE TABLE public.member_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  
  -- 기본 정보
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT, -- Made nullable for initial signup, can be updated later
  birth_date DATE, -- Made nullable for initial signup, can be updated later
  real_name TEXT, -- Made nullable for initial signup, can be updated later
  
  -- 조합비 정보
  monthly_fee INTEGER CHECK (monthly_fee >= 10000 AND monthly_fee <= 50000), -- Made nullable for initial signup
  
  -- 계좌 정보
  bank_name TEXT, -- Made nullable for initial signup
  account_number TEXT, -- Made nullable for initial signup
  account_holder TEXT, -- Made nullable for initial signup
  
  -- 상태 관리
  registration_status TEXT DEFAULT 'pending' 
    CHECK (registration_status IN ('pending', 'approved', 'rejected')),
  is_active BOOLEAN DEFAULT FALSE,
  
  -- 관리자 정보
  is_admin BOOLEAN DEFAULT FALSE,
  
  -- 메타데이터
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID REFERENCES auth.users(id)
);

-- Create posts table (using schema from docs/ggac_board_plan_v2.md)
CREATE TABLE public.posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '잡담' CHECK (category IN ('공지', '잡담', '홍보', '건의')),
  author_id UUID REFERENCES public.member_profiles(id) ON DELETE CASCADE NOT NULL, -- Reference new member_profiles
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

-- Create comments table (using schema from 20250707003000_fixed_board_schema.sql)
CREATE TABLE public.comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid REFERENCES public.posts ON DELETE CASCADE NOT NULL,
  author_id uuid REFERENCES public.member_profiles(id) ON DELETE CASCADE NOT NULL, -- Reference new member_profiles
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable Row Level Security for new tables
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- RLS policies for member_profiles (from docs/ggac_board_plan_v2.md)
CREATE POLICY "Users can view own profile" ON public.member_profiles 
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can insert own profile" ON public.member_profiles 
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.member_profiles 
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles" ON public.member_profiles 
  FOR SELECT USING (is_admin = true AND is_active = true);

CREATE POLICY "Admins can approve members" ON public.member_profiles 
  FOR UPDATE USING (is_admin = true AND is_active = true);

-- RLS policies for posts (from docs/ggac_board_plan_v2.md)
CREATE POLICY "Approved members can view posts" ON public.posts 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    ) AND is_deleted = false
  );

CREATE POLICY "Approved members can create posts" ON public.posts 
  FOR INSERT WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );

CREATE POLICY "Authors can update own posts" ON public.posts 
  FOR UPDATE USING (author_id = auth.uid());

CREATE POLICY "Authors can delete own posts" ON public.posts 
  FOR DELETE USING (author_id = auth.uid()); -- Added DELETE policy for authors

-- RLS policies for comments (from 20250707003000_fixed_board_schema.sql)
CREATE POLICY "Allow logged-in users to read all comments" ON public.comments
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow members to create comments" ON public.comments
  FOR INSERT WITH CHECK ((SELECT registration_status FROM public.member_profiles WHERE id = auth.uid()) = 'approved'); -- Updated to use registration_status

CREATE POLICY "Allow users to update their own comments" ON public.comments
  FOR UPDATE USING (auth.uid() = author_id);

CREATE POLICY "Allow users to delete their own comments" ON public.comments
  FOR DELETE USING (auth.uid() = author_id);

-- Re-create function to automatically create profile when user signs up
-- Updated to insert into member_profiles with default values for new fields
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.member_profiles (id, email, display_name, registration_status, is_active)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'display_name', new.email), 'pending', FALSE);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger to call function when new user is created
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Re-create function to update updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger for posts updated_at
DROP TRIGGER IF EXISTS update_posts_updated_at ON public.posts;
CREATE TRIGGER update_posts_updated_at
    BEFORE UPDATE ON public.posts
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();

-- Re-create trigger for comments updated_at
DROP TRIGGER IF EXISTS update_comments_updated_at ON public.comments;
CREATE TRIGGER update_comments_updated_at
    BEFORE UPDATE ON public.comments
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();

-- Set up Realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.member_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;

-- Create indexes (from docs/ggac_board_plan_v2.md)
CREATE INDEX IF NOT EXISTS idx_member_profiles_status ON public.member_profiles(registration_status, is_active);
CREATE INDEX IF NOT EXISTS idx_posts_author ON public.posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts(created_at DESC);