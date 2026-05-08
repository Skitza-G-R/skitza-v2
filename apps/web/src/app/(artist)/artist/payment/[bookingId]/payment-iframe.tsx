'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function PaymentIframe({
  iframeUrl,
  bookingId,
}: {
  iframeUrl: string;
  bookingId: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      try {
        // Try to read the iframe's current URL
        // This will throw a cross-origin error unless we're on the same origin
        const iframeHref = iframe.contentWindow?.location.href;
        if (iframeHref && iframeHref.includes('/api/tranzila/callback')) {
          const iframeParams = new URL(iframeHref).searchParams;
          const tranzilaStatus = iframeParams.get('status') ?? '';
          const confirmationCode = iframeParams.get('ConfirmationCode') ?? '';

          setStatus('processing');
          fetch(
            `/api/tranzila/callback?bookingId=${bookingId}&status=${tranzilaStatus}&confirmationCode=${confirmationCode}`,
          )
            .then(async (res) => {
              const data = (await res.json()) as { ok: boolean };
              if (data.ok) {
                setStatus('done');
                router.push('/artist?payment=success');
              } else {
                setStatus('error');
              }
            })
            .catch(() => setStatus('error'));
        }
      } catch {
        // Cross-origin — iframe is still on Tranzila's domain, ignore
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [bookingId, router]);

  if (status === 'processing') {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[rgb(var(--fg-muted))]">Confirming your payment…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-[rgb(var(--fg-muted))]">Payment verification failed.</p>
        <button
          onClick={() => setStatus('idle')}
          className="text-sm text-[rgb(var(--brand-primary))] hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={iframeUrl}
      className="w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]"
      style={{ minHeight: '480px' }}
      title="Secure payment"
      allow="payment"
    />
  );
}
