"use client";

import { UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

import {
  getBrowserRuntimeStorage,
  readRuntimeLaunchTarget,
} from "~/lib/runtime-state/runtime-state";

import { Icon } from "./icons";

function producerResolverHref(nextHref: string): string {
  const query = new URLSearchParams({ next: nextHref });
  return `/launch/resolve?${query.toString()}`;
}

export function ArtistUserButton({
  userId,
  isProducer,
  settingsHref,
  ringClassName,
}: {
  userId: string;
  isProducer: boolean;
  settingsHref: string;
  ringClassName: string;
}) {
  const [producerHref, setProducerHref] = useState(() =>
    producerResolverHref("/dashboard"),
  );

  useEffect(() => {
    if (!isProducer) return;
    const storage = getBrowserRuntimeStorage();
    if (!storage) return;
    const target = readRuntimeLaunchTarget(storage, userId);
    if (target?.role === "producer") {
      setProducerHref(producerResolverHref(target.href));
    }
  }, [isProducer, userId]);

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: `h-11 w-11 ring-1 ${ringClassName}`,
        },
      }}
    >
      <UserButton.MenuItems>
        <UserButton.Link
          label="Settings"
          labelIcon={<Icon name="settings" size={16} />}
          href={settingsHref}
        />
        {isProducer ? (
          <UserButton.Link
            label="Switch to Producer"
            labelIcon={<Icon name="home" size={16} />}
            href={producerHref}
          />
        ) : null}
      </UserButton.MenuItems>
    </UserButton>
  );
}
