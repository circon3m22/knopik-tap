import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://uxxzvjwsexdoqcevzipu.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_udSUp7QJMnvfAC6YFlWdlQ_vBaIRmdi";

let browserClient: SupabaseClient | null = null;

export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY;

export function getSupabaseClient() {
  browserClient ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });

  return browserClient;
}

export function usernameToEmail(username: string) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(normalized)) return null;
  return `${normalized}@knopik.local`;
}
