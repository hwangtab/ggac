import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

let _supabaseClient: ReturnType<typeof createClientComponentClient> | null = null;

export function getSupabaseClient() {
  if (!_supabaseClient) {
    _supabaseClient = createClientComponentClient();
  }
  return _supabaseClient;
}

// 기존 호환성을 위한 export (getter 사용)
export const supabase = new Proxy({} as ReturnType<typeof createClientComponentClient>, {
  get(target, prop) {
    const client = getSupabaseClient();
    return (client as any)[prop];
  }
});