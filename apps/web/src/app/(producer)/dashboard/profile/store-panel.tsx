import type { Currency } from "~/app/(producer)/dashboard/booking/package-form";
import {
  ServicesSection,
  type ServicePackageRow,
} from "~/components/dashboard/setup/services-section";

export function StorePanel({
  packages,
  defaultCurrency,
}: {
  packages: ServicePackageRow[];
  defaultCurrency: Currency;
}) {
  return (
    <ServicesSection packages={packages} defaultCurrency={defaultCurrency} />
  );
}
