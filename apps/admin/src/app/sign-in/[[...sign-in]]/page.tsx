import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="access-page">
      <section style={{ width: "min(100%, 31rem)" }}>
        <div style={{ marginBottom: "1.25rem", textAlign: "center" }}>
          <div className="access-mark" aria-hidden="true">
            S
          </div>
          <p className="eyebrow" style={{ marginTop: "1rem" }}>
            Private founder access
          </p>
        </div>
        <div className="admin-sign-in">
          <SignIn
            fallbackRedirectUrl="/unlock"
            forceRedirectUrl="/unlock"
            transferable={false}
            withSignUp={false}
          />
        </div>
      </section>
    </main>
  );
}
