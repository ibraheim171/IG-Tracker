import { AccountMenu } from "@/components/account-menu";
import { AppNavigation } from "@/components/app-navigation";
import type { Enums } from "@/lib/database.types";

type RoleName = Enums<"role_name">;

export function Header({ displayName, roles }: { displayName: string; roles: RoleName[] }) {
  return (
    <header className="app-header">
      <div className="brand-row">
        <span className="brand-mark" aria-hidden="true">أ</span>
        <span className="brand-copy">
          <strong>سنفتح أقصانا</strong>
          <small>إدارة دورة المحتوى</small>
        </span>
      </div>
      <AppNavigation />
      <AccountMenu displayName={displayName} roles={roles} />
    </header>
  );
}
