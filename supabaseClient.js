import { createClient } from '@supabase/supabase-js'

// Safe to be visible in the browser — this is the "publishable" key, not the secret one.
// Row Level Security on every table is what actually keeps families' data separate.
const supabaseUrl = 'https://rwmxnylljpnscaembvrc.supabase.co'
const supabaseAnonKey = 'sb_publishable_lHzi1LJHTAhDeb5ai9BMTg_6f7cTB3C'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
