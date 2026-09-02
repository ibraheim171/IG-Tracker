import type { Role } from "@/lib/admin-users";

export type PasswordMode = "manual" | "generated";

export type CreateUserDraft = {
  displayName: string;
  email: string;
  roles: Role[];
  passwordMode: PasswordMode;
  temporaryPassword: string;
};

export function createEmptyUserDraft(): CreateUserDraft {
  return {
    displayName: "",
    email: "",
    roles: ["writer"],
    passwordMode: "generated",
    temporaryPassword: "",
  };
}
