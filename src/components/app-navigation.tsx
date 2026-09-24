"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";

const navigationItems = [
  { href: "/admin/dashboard", label: "لوحة الأدمن", icon: "dashboard", adminOnly: true },
  { href: "/schedule", label: "خطة النشر", icon: "calendar", adminOnly: false },
  { href: "/ready", label: "جاهز للنشر", icon: "send", adminOnly: false },
  { href: "/waiting", label: "بانتظار", icon: "clock", adminOnly: false },
  { href: "/my", label: "موادي", icon: "file", adminOnly: false },
  { href: "/insights", label: "الإحصائيات", icon: "stats", adminOnly: true },
  { href: "/admin/monthly-reports", label: "التقرير الشهري", icon: "report", adminOnly: true },
  { href: "/admin/data-export", label: "تصدير البيانات", icon: "download", adminOnly: true },
] as const;

function NavigationIcon({ name }: { name: (typeof navigationItems)[number]["icon"] }) {
  if (name === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (name === "send") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (name === "stats") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 20V10M12 20V4M19 20v-7" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
      </svg>
    );
  }
  if (name === "report") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3h9l3 3v15H6V3Zm3 5h6M9 12h6M9 16h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

export function AppNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  function markPending(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      pathname === href
    ) {
      return;
    }
    setPendingHref(href);
  }

  const visualPathname = pendingHref ?? pathname;

  return (
    <nav className={`nav-links${isAdmin ? " nav-links-admin" : ""}`} aria-label="التنقل الرئيسي">
      {navigationItems.filter((item) => !item.adminOnly || isAdmin).map((item) => {
        const isCurrent = pathname.startsWith(item.href);
        const isVisuallyActive = visualPathname.startsWith(item.href);
        const isPending = pendingHref === item.href && !isCurrent;
        return (
          <Link
            className={`nav-link${isVisuallyActive ? " is-active" : ""}${isPending ? " is-pending" : ""}`}
            href={item.href}
            key={item.href}
            prefetch={!isCurrent}
            aria-current={isCurrent ? "page" : undefined}
            aria-busy={isPending || undefined}
            onClick={(event) => markPending(event, item.href)}
          >
            <span className="nav-icon"><NavigationIcon name={item.icon} /></span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
