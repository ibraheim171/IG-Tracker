"use client";

import { useEffect } from "react";

export default function ProtectedError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page wide-page stack">
      <section className="card stack" role="alert">
        <div>
          <p className="eyebrow">تعذّر فتح الصفحة</p>
          <h1>حاول مجددًا</h1>
        </div>
        <p>تعذر تحميل هذه الصفحة. حاول مجددًا. رمز التشخيص: PAGE_LOAD.</p>
        <button className="button" type="button" onClick={reset}>إعادة المحاولة</button>
      </section>
    </main>
  );
}
