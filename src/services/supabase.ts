import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { auth } from './firebase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !publishableKey) {
  console.warn('Supabase is not configured; metadata mirroring and server search are disabled.')
}

// Requests are authorised with the signed-in user's Firebase ID token, which
// Supabase accepts as a third-party token; row-level security does the rest.
// Only the publishable key is used here, never a secret or service-role key.
export const supabase: SupabaseClient | null =
  supabaseUrl && publishableKey
    ? createClient(supabaseUrl, publishableKey, {
        accessToken: async () => (await auth.currentUser?.getIdToken(false)) ?? null,
      })
    : null
