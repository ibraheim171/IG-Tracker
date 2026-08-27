import { Header } from "@/components/header";
import { getCurrentProfile } from "@/lib/auth";

export const preferredRegion = "hnd1";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const profile = await getCurrentProfile();
  return (
    <div className="app-shell">
      <Header displayName={profile.display_name} />
      <div className="app-content">{children}</div>
    </div>
  );
}
