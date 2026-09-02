import { requireAdmin } from "@/lib/auth";
import { listAdminUsers } from "@/lib/admin-users-server";
import { UsersManager } from "./users-manager";

export default async function UsersPage() {
  await requireAdmin();
  try {
    const users = await listAdminUsers();
    return <main className="page wide-page stack"><h1>إدارة المستخدمين</h1><UsersManager initialUsers={users} /></main>;
  } catch {
    return <main className="page wide-page stack"><h1>إدارة المستخدمين</h1><UsersManager initialUsers={[]} initialError="تعذر تحميل قائمة المستخدمين. [E_USERS_LOAD]" /></main>;
  }
}
