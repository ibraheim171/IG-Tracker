import { LogoutButton } from "@/components/logout-button";

export function Header({ displayName }: { displayName: string }) {
  return <header className="header"><strong>{displayName}</strong><LogoutButton /></header>;
}
