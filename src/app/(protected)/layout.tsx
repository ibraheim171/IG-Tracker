import { Header } from "@/components/header";
import { ReferenceDataProvider } from "@/components/reference-data-provider";
import { getCurrentProfile } from "@/lib/auth";

export const preferredRegion = "hnd1";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const profile = await getCurrentProfile();
  return (
    <ReferenceDataProvider>
      <div className="app-shell">
        <Header displayName={profile.display_name} roles={profile.roles} />
        <div className="app-content">{children}</div>
      </div>
    </ReferenceDataProvider>
  );
}
