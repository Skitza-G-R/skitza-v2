import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";

export function AccessCard({
  children,
  eyebrow,
  showAccount = false,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  showAccount?: boolean;
  title: string;
}) {
  return (
    <main className="access-page">
      <section className="access-card">
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <div className="access-mark" aria-hidden="true">
            S
          </div>
          {showAccount ? <UserButton /> : null}
        </div>
        <p className="eyebrow" style={{ marginTop: "1.5rem" }}>
          {eyebrow}
        </p>
        <h1 className="access-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}
