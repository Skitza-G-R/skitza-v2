// Tranzila DirectNG iframe — PCI scope stays with Tranzila. Card
// details are typed into Tranzila's hosted iframe and never touch our
// origin. DirectNG requires POST form submission (not GET URL params),
// so we render a hidden <form> and a tiny inline script that submits
// it on page load. The form's `target` attribute matches the iframe's
// `name`, so the POST response renders inside the iframe rather than
// navigating the top-level window.
//
// On success/failure Tranzila navigates the top-level window to
// /artist/payment/success or back here with ?error=payment_failed.

export function PaymentIframe({
  formAction,
  postParams,
}: {
  formAction: string;
  postParams: Record<string, string>;
}) {
  return (
    <>
      <form
        id="tranzila-form"
        action={formAction}
        method="POST"
        target="tranzila-iframe"
        style={{ display: "none" }}
      >
        {Object.entries(postParams).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      </form>
      <iframe
        name="tranzila-iframe"
        className="w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]"
        style={{ minHeight: "480px" }}
        title="Secure payment"
        allow="payment"
      />
      <script
        dangerouslySetInnerHTML={{
          __html: 'document.getElementById("tranzila-form").submit();',
        }}
      />
    </>
  );
}
