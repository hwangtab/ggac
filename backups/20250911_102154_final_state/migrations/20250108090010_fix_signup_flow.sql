-- Fix signup flow and improve trigger functions
-- Created: 2025-01-08
-- Purpose: Resolve member signup issues and improve data storage reliability

-- 1. Remove existing problematic triggers and functions
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
DROP FUNCTION IF EXISTS public.handle_email_confirmed();

-- 2. Improve the main trigger function with better error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into member_profiles with comprehensive error handling
  INSERT INTO public.member_profiles (
    id, 
    email, 
    display_name, 
    real_name, 
    phone_number, 
    birth_date,
    monthly_fee, 
    bank_name, 
    account_number, 
    account_holder,
    registration_status, 
    is_active
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.raw_user_meta_data->>'real_name',
    NEW.raw_user_meta_data->>'phone_number',
    CASE 
      WHEN NEW.raw_user_meta_data->>'birth_date' IS NOT NULL AND NEW.raw_user_meta_data->>'birth_date' != ''
      THEN (NEW.raw_user_meta_data->>'birth_date')::date
      ELSE NULL
    END,
    CASE 
      WHEN NEW.raw_user_meta_data->>'monthly_fee' IS NOT NULL AND NEW.raw_user_meta_data->>'monthly_fee' != ''
      THEN (NEW.raw_user_meta_data->>'monthly_fee')::integer
      ELSE NULL
    END,
    NEW.raw_user_meta_data->>'bank_name',
    NEW.raw_user_meta_data->>'account_number',
    NEW.raw_user_meta_data->>'account_holder',
    'pending'::public.member_status,
    FALSE
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Update fields if conflict occurs (in case of retry)
    email = EXCLUDED.email,
    display_name = COALESCE(EXCLUDED.display_name, member_profiles.display_name),
    real_name = COALESCE(EXCLUDED.real_name, member_profiles.real_name),
    phone_number = COALESCE(EXCLUDED.phone_number, member_profiles.phone_number),
    birth_date = COALESCE(EXCLUDED.birth_date, member_profiles.birth_date),
    monthly_fee = COALESCE(EXCLUDED.monthly_fee, member_profiles.monthly_fee),
    bank_name = COALESCE(EXCLUDED.bank_name, member_profiles.bank_name),
    account_number = COALESCE(EXCLUDED.account_number, member_profiles.account_number),
    account_holder = COALESCE(EXCLUDED.account_holder, member_profiles.account_holder),
    updated_at = NOW();
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't fail the authentication
    RAISE WARNING 'Failed to create profile for user %: % %', NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Recreate trigger to run on email confirmation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_new_user();

-- 4. Update RLS policies for better permission handling

-- Remove existing problematic policies
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Service role can access all profiles" ON public.member_profiles;

-- Create improved INSERT policy that works with triggers
CREATE POLICY "Allow profile creation" ON public.member_profiles
  FOR INSERT 
  WITH CHECK (
    -- Allow if user is creating their own profile
    auth.uid() = id OR 
    -- Allow service role for admin operations
    auth.role() = 'service_role' OR
    -- Allow for trigger execution (SECURITY DEFINER functions)
    current_setting('role', true) = 'postgres'
  );

-- Recreate service role policy for admin operations
CREATE POLICY "Service role full access" ON public.member_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. Create a function for manual profile creation (fallback)
CREATE OR REPLACE FUNCTION public.create_member_profile(
  user_id UUID,
  user_email TEXT,
  user_display_name TEXT DEFAULT NULL,
  user_real_name TEXT DEFAULT NULL,
  user_phone_number TEXT DEFAULT NULL,
  user_birth_date DATE DEFAULT NULL,
  user_monthly_fee INTEGER DEFAULT NULL,
  user_bank_name TEXT DEFAULT NULL,
  user_account_number TEXT DEFAULT NULL,
  user_account_holder TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_id UUID;
BEGIN
  INSERT INTO public.member_profiles (
    id, email, display_name, real_name, phone_number, birth_date,
    monthly_fee, bank_name, account_number, account_holder,
    registration_status, is_active
  )
  VALUES (
    user_id, user_email, 
    COALESCE(user_display_name, user_email),
    user_real_name, user_phone_number, user_birth_date,
    user_monthly_fee, user_bank_name, user_account_number, user_account_holder,
    'pending'::public.member_status, FALSE
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(EXCLUDED.display_name, member_profiles.display_name),
    updated_at = NOW()
  RETURNING id INTO profile_id;
  
  RETURN profile_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create member profile: % %', SQLSTATE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- 6. Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.create_member_profile TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO authenticated;

-- 7. Add helpful comments
COMMENT ON FUNCTION public.handle_new_user() IS 'Trigger function to create member profile when user email is confirmed';
COMMENT ON FUNCTION public.create_member_profile IS 'Manual function to create member profile with fallback support';

-- Migration completed successfully
SELECT 'Migration 20250108_fix_signup_flow completed successfully' as status;