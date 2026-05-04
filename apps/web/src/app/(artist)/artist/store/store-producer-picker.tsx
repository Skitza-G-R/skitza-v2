"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { ProducerPicker } from "~/components/artist/producer-picker";

type Studio = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

export function StoreProducerPicker({ studios }: { studios: Studio[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId =
    searchParams.get("studio") ?? studios[0]?.producerId ?? null;
  return (
    <ProducerPicker
      studios={studios}
      activeId={activeId}
      onSelect={(id) => {
        router.push(`/artist/store?studio=${id}`);
      }}
    />
  );
}
