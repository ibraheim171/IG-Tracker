import { cache } from "react";
import { redirect } from "next/navigation";
import { isProtectedProfileAllowed } from "@/lib/admin-users-core";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/database.types";

export type Profile = Tables<"profiles">;

export const getCurrentProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile || !isProtectedProfileAllowed(profile)) redirect("/login");
  return profile;
});

export async function requireAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile.roles.includes("admin")) redirect("/health");
  return profile;
}
