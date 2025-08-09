# PostList and CommentSection "Loading..." Issue - Diagnosis Report

## Issue Description
Post author names and comment author names display as "Loading..." instead of actual user names when logged in as a different user than the original author.

## Root Cause
**Overly restrictive Row Level Security (RLS) policies** on the `member_profiles` table prevent authenticated users from viewing basic profile information of other users.

## Technical Analysis

### Current RLS Policy (Problematic)
```sql
CREATE POLICY "Users can view own profile" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);
```

This policy only allows users to see their own profile, blocking access to other users' profiles.

### Component Behavior
1. **PostList.tsx** (lines 34-54): Fetches author profiles using:
   ```javascript
   const { data, error } = await supabase
     .from('member_profiles')
     .select('id, display_name')
     .in('id', authorIds);
   ```

2. **CommentSection.tsx** (lines 52-67): Similar pattern for comment authors

3. **Result**: When User A tries to view posts by User B, the profile fetch fails due to RLS, causing "Loading..." to persist

### Evidence from Testing
- Anonymous client cannot access any data (expected)
- Authenticated users can only see their own profile (problematic)
- Profile fetching in components returns empty results for other users' IDs

## Solution: Fix RLS Policy

### Recommended Fix
Replace the restrictive policy with one that allows authenticated users to view basic profile information of approved members:

```sql
-- Drop the overly restrictive policy
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;

-- Create a new policy that allows viewing basic profile info
CREATE POLICY "Authenticated users can view basic profile info" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (
    -- Allow users to see their own full profile
    auth.uid() = id 
    OR 
    -- Allow users to see basic info of other approved members
    (registration_status = 'approved' AND is_active = true)
  );
```

### Security Considerations
- Users can still only see their own full profile data
- Other users' profiles are only visible if they are approved and active members
- Sensitive fields (phone, bank info, etc.) should be excluded from component queries if needed
- This maintains security while enabling proper functionality

### Impact
- ✅ Fixes "Loading..." issue in PostList and CommentSection
- ✅ Maintains security by only showing approved members' basic info
- ✅ Allows proper author name display in posts and comments
- ✅ No changes needed to frontend components

## Files Affected
- `supabase/migrations/20250707_fix_rls_policies.sql` - Contains current problematic policy
- `src/components/PostList.tsx` - Profile fetching logic (no changes needed)
- `src/components/CommentSection.tsx` - Profile fetching logic (no changes needed)

## Next Steps
1. Apply the SQL fix to the Supabase database
2. Test with authenticated users viewing posts/comments by other users
3. Verify author names display correctly instead of "Loading..."
4. Monitor for any security implications

## Testing Checklist
- [ ] User A can view posts by User B and see User B's name
- [ ] User A can view comments by User B and see User B's name  
- [ ] User A cannot access User B's sensitive profile information
- [ ] Unapproved users' profiles are not visible to others
- [ ] Users can still view/edit their own full profile