import { Header } from "@/components/header";
import { getCurrentProfile } from "@/lib/auth";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const profile = await getCurrentProfile();
  return <><Header displayName={profile.display_name} />{children}</>;
}
