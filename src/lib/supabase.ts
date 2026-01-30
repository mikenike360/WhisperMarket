/**
 * Supabase client for market metadata.
 * Uses NEXT_PUBLIC_ vars so it works in the browser.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

let clientInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return clientInstance;
}

export type MarketMetadataRow = {
  market_id: string;
  title: string;
  description: string;
  category: string | null;
  creator_address: string | null;
  transaction_id: string | null;
  metadata_hash: string | null;
  created_at?: string;
  updated_at?: string;
};
