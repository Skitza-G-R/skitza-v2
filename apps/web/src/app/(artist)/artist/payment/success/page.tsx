import { LegacyCardReturnUnavailable } from "~/components/artist/payment/legacy-card-return-unavailable";
import { legacyCardReturnState } from "~/server/payments/legacy-card-containment";

export default function PaymentSuccessPage() {
  const state = legacyCardReturnState();

  return (
    <LegacyCardReturnUnavailable
      title={state.title}
      explanation={state.explanation}
      nextStep={state.nextStep}
      safetyNotice={state.safetyNotice}
    />
  );
}
