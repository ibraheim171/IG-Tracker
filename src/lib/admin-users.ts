import type { Database, Json, Tables } from "@/lib/database.types";

export type Role = Database["public"]["Enums"]["role_name"];
export type Profile = Tables<"profiles">;

export const allowedRoles: Role[] = ["writer", "reviewer", "producer", "publisher", "admin"];

export const roleLabels: Record<Role, string> = {
  writer: "كاتب",
  reviewer: "مراجع",
  producer: "منتج",
  publisher: "مسؤول النشر",
  admin: "أدمن",
};

export type AdminUser = {
  id: string;
  display_name: string;
  email: string;
  roles: Role[];
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_sign_in_at: string | null;
};

export type AdminAuditOperation =
  | "create_user"
  | "update_display_name"
  | "update_email"
  | "update_roles"
  | "activate_user"
  | "deactivate_user"
  | "reset_password"
  | "delete_user"
  | "reassign_tasks";

export type AdminAuditPhase = "started" | "succeeded" | "failed";

export type AuditValues = Record<string, Json>;
