import { AppNavigation } from "@/components/app-navigation";
import { LogoutButton } from "@/components/logout-button";

export function Header({ displayName }: { displayName: string }) {
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
      <div className="account-panel">
        <span className="account-name">{displayName}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
