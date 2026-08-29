"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";

const navigationItems = [
  { href: "/", label: "خطة النشر", icon: "calendar" },
  { href: "/ready", label: "جاهز للنشر", icon: "send" },
  { href: "/waiting", label: "بانتظار", icon: "clock" },
  { href: "/my", label: "موادي", icon: "file" },
] as const;

function NavigationIcon({ name }: { name: (typeof navigationItems)[number]["icon"] }) {
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
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

export function AppNavigation() {
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
    <nav className="nav-links" aria-label="التنقل الرئيسي">
      {navigationItems.map((item) => {
        const isCurrent = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const isVisuallyActive = item.href === "/" ? visualPathname === "/" : visualPathname.startsWith(item.href);
        const isPending = pendingHref === item.href && !isCurrent;
        return (
          <Link
            className={`nav-link${isVisuallyActive ? " is-active" : ""}${isPending ? " is-pending" : ""}`}
            href={item.href}
            key={item.href}
            prefetch={true}
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
