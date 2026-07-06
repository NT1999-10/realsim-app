// Supabase クライアント(認証+プラン管理)
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定の場合、
// authEnabled=false となり、アプリは従来のライセンスキー方式で動作します。
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anon ? createClient(url, anon) : null;
export const authEnabled = !!supabase;
