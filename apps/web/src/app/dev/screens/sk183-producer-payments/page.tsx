import { notFound } from "next/navigation";

import { Sk183ProducerPaymentsDevScreen } from "~/components/dev/sk183-producer-payments-dev-screen";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

export default function Sk183ProducerPaymentsDevPage() {
  if (!isDevGalleryAvailable()) notFound();

  return <Sk183ProducerPaymentsDevScreen />;
}
