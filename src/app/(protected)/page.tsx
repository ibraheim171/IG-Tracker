import { getCurrentProfile } from "@/lib/auth";
import { homePathForRoles } from "@/lib/home-routing";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const profile = await getCurrentProfile();
  redirect(homePathForRoles(profile.roles));
}
