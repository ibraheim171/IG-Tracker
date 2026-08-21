import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function latinDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hebron" }).format(new Date(value)) : "—";
}

export default async function HealthPage() {
  const [profile, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const [items, slots, posts, board] = await Promise.all([
    supabase.from("items").select("id", { count: "exact", head: true }),
    supabase.from("publishing_slots").select("id", { count: "exact", head: true }),
    supabase.from("ig_posts").select("media_id", { count: "exact", head: true }),
    supabase.from("v_slot_board").select("slot_id, slot_at, state, n_items, n_ready").gte("slot_at", new Date().toISOString()).order("slot_at", { ascending: true }).limit(4),
  ]);
  return <main className="page stack"><h1>فحص الاتصال</h1>
    <section className="card stack"><h2>المستخدم الحالي</h2><p>{profile.display_name}</p><p className="num">{profile.roles.join(" · ")}</p></section>
    <section className="card stack"><h2>عدد الصفوف</h2><p>العناصر: <span className="num">{(items.count ?? 0).toLocaleString("en-US")}</span></p><p>مواعيد النشر: <span className="num">{(slots.count ?? 0).toLocaleString("en-US")}</span></p><p>منشورات إنستغرام: <span className="num">{(posts.count ?? 0).toLocaleString("en-US")}</span></p></section>
    <section className="card stack"><h2>مواعيد النشر القادمة</h2>{board.data?.length ? <div className="table-wrap"><table><thead><tr><th>الموعد</th><th>الحالة</th><th>العناصر</th><th>الجاهزة</th></tr></thead><tbody>{board.data.map((slot) => <tr key={slot.slot_id}><td className="num">{latinDate(slot.slot_at)}</td><td>{slot.state ?? "—"}</td><td className="num">{(slot.n_items ?? 0).toLocaleString("en-US")}</td><td className="num">{(slot.n_ready ?? 0).toLocaleString("en-US")}</td></tr>)}</tbody></table></div> : <p>لا توجد مواعيد قادمة.</p>}</section>
  </main>;
}
