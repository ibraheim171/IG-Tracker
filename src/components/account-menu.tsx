"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Enums } from "@/lib/database.types";

type RoleName = Enums<"role_name">;
type ThemeChoice = "light" | "dark" | "system";

const themeCookieName = "aqsana_theme";
const themeChoices: Array<{ value: ThemeChoice; label: string }> = [
  { value: "light", label: "فاتح" },
  { value: "dark", label: "داكن" },
  { value: "system", label: "حسب الجهاز" },
];

const roleLabels: Record<RoleName, string> = {
  writer: "كاتب",
  reviewer: "مراجع",
  producer: "منتج",
  admin: "مدير",
};

function normalizeTheme(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function readThemeCookie(): ThemeChoice {
  const match = document.cookie.match(new RegExp(`(?:^|; )${themeCookieName}=([^;]+)`));
  return normalizeTheme(match ? decodeURIComponent(match[1]) : null);
}

function writeThemeCookie(theme: ThemeChoice) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${themeCookieName}=${encodeURIComponent(theme)}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
}

function firstVisibleLetter(displayName: string) {
  return Array.from(displayName.trim()).find((letter) => letter.trim().length > 0) ?? "؟";
}

export function AccountMenu({ displayName, roles }: { displayName: string; roles: RoleName[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const isAdmin = roles.includes("admin");
  const roleText = useMemo(() => roles.map((role) => roleLabels[role]).join("، ") || "عضو", [roles]);
  const initial = firstVisibleLetter(displayName);

  useEffect(() => {
    const currentTheme = readThemeCookie();
    setTheme(currentTheme);
    document.documentElement.dataset.theme = currentTheme;
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function chooseTheme(nextTheme: ThemeChoice) {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    writeThemeCookie(nextTheme);
  }

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="account-panel" ref={rootRef}>
      <button
        type="button"
        className="account-trigger"
        aria-label={`قائمة الحساب: ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="account-avatar" aria-hidden="true">{initial}</span>
        <span className="account-trigger-name">{displayName}</span>
        <span className="account-trigger-chevron" aria-hidden="true">⌄</span>
      </button>

      {open ? (
        <div className="account-menu" id={menuId} role="menu" aria-label="قائمة الحساب">
          <div className="account-menu-head" role="none">
            <span className="account-menu-avatar" aria-hidden="true">{initial}</span>
            <span className="account-menu-identity">
              <strong>{displayName}</strong>
              <span>{roleText}</span>
            </span>
          </div>

          <div className="account-menu-section" role="group" aria-label="المظهر">
            <span className="account-menu-label">المظهر</span>
            <div className="theme-options">
              {themeChoices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`theme-choice${theme === choice.value ? " is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={theme === choice.value}
                  onClick={() => chooseTheme(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          <Link className="account-menu-link" role="menuitem" href="/account/password" onClick={() => setOpen(false)}>
            تغيير كلمة المرور
          </Link>

          {isAdmin ? (
            <>
              <Link className="account-menu-link" role="menuitem" href="/admin/users" onClick={() => setOpen(false)}>
                إدارة المستخدمين
              </Link>
              <Link className="account-menu-link" role="menuitem" href="/health" onClick={() => setOpen(false)}>
                فحص النظام
              </Link>
            </>
          ) : null}

          <button className="account-menu-action account-menu-danger" type="button" role="menuitem" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      ) : null}
    </div>
  );
}
