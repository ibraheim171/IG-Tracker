import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UsersManager } from "./users-manager";

export default async function UsersPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: profiles } = await supabase.from("profiles").select("*").order("display_name", { ascending: true });
  return <main className="page stack"><h1>إدارة المستخدمين</h1><UsersManager initialProfiles={profiles ?? []} /></main>;
}
