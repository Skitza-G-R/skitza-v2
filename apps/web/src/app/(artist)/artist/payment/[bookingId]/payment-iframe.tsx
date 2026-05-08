// Tranzila iframe — PCI scope stays with Tranzila. Card details are
// typed into Tranzila's hosted iframe and never touch our origin. On
// success/failure Tranzila navigates the top-level window to
// /artist/payment/success or back here with ?error=payment_failed.

export function PaymentIframe({ iframeUrl }: { iframeUrl: string }) {
  return (
    <iframe
      src={iframeUrl}
      className="w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]"
      style={{ minHeight: "480px" }}
      title="Secure payment"
      allow="payment"
    />
  );
}
