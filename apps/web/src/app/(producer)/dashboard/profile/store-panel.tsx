import {
  ServicesSection,
  type ServicePackageRow,
} from "~/components/dashboard/setup/services-section";

export function StorePanel({ packages }: { packages: ServicePackageRow[] }) {
  return <ServicesSection packages={packages} />;
}
