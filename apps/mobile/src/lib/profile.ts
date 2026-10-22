import {
  INVALID_TIME_ZONE_CODE,
  PROFILE_FORM_COLUMNS,
  type ProfileFormValues,
  profileFormValues,
  profileUpdateColumns,
} from "@fin-creador/api";
import { profileUpdateSchema } from "@fin-creador/schemas";
import { type FormState, validate } from "./form-state";
import { getSupabase } from "./supabase";

// Same rules as apps/web/app/(app)/settings: shared schema, the five granted columns,
// and RLS limits every read and write to the signed-in user's own row.

export type ProfileLoad = { ok: true; values: ProfileFormValues; email: string } | { ok: false };

export async function loadProfile(): Promise<ProfileLoad> {
  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false };
  const { data, error } = await supabase.from("profiles").select(PROFILE_FORM_COLUMNS).eq("id", auth.user.id).maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true, values: profileFormValues(data), email: auth.user.email ?? "" };
}

export async function saveProfile(input: ProfileFormValues): Promise<FormState> {
  const result = validate(profileUpdateSchema, input);
  if (!result.ok) return result.state;

  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: "error", message: "Your session has ended. Please sign in again." };

  const { data, error } = await supabase
    .from("profiles")
    .update(profileUpdateColumns(result.data))
    .eq("id", auth.user.id)
    .select("id")
    .maybeSingle();

  if (error?.code === INVALID_TIME_ZONE_CODE) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: { timeZone: "Unknown time zone" } };
  }
  if (error || !data) return { status: "error", message: "We couldn’t save your profile. Please try again." };
  return { status: "success", message: "Profile saved." };
}
