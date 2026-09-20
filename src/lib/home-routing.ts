export function homePathForRoles(roles: string[]) {
  return roles.includes("admin") ? "/admin/dashboard" as const : "/schedule" as const;
}
