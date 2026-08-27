import { LogoutButton } from "@/components/logout-button";
import Link from "next/link";

export function Header({ displayName }: { displayName: string }) {
  return <header className="header"><strong>{displayName}</strong><nav className="nav-links" aria-label="التنقل"><Link href="/">فتحات النشر</Link><Link href="/ready">جاهز للنشر</Link><Link href="/waiting">بانتظار</Link><Link href="/my">موادي</Link></nav><LogoutButton /></header>;
}
