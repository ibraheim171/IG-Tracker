import { Header } from "@/components/header";
import { ReferenceDataProvider } from "@/components/reference-data-provider";
import { getCurrentProfile } from "@/lib/auth";
import { getReferenceData } from "@/lib/reference-data";

export const preferredRegion = "hnd1";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [profile, referenceData] = await Promise.all([getCurrentProfile(), getReferenceData()]);
  return (
    <ReferenceDataProvider data={referenceData}>
      <div className="app-shell">
        <Header displayName={profile.display_name} />
        <div className="app-content">{children}</div>
      </div>
    </ReferenceDataProvider>
  );
}
