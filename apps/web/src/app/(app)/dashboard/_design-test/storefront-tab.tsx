/* eslint-disable @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-unused-vars */
"use client";

// Skitza Design Test — Storefront tab. Simplified port of the
// mockup's StorefrontTab + sub-components (sample-app/index.html
// lines 3339-4109). Renders three sections that match the mockup:
// 1) PublicLinkStrip — the live/published toggle + URL + preview
// 2) PageSnapshot — a thumbnail of what artists see at /join/<slug>
// 3) ProductsList — editable list of services with visibility/featured
//
// Out of scope this round: ProductEditorDrawer (the right-side panel
// that opens when you click Edit on a product) and PublicPagePreview
// (the overlay preview). Both are visual-only modals in the mockup
// that sit on top of this surface — they don't change what's wired.
//
// Wired data:
// - Products list comes from real booking.list (ServicePackage rows)
// - Public link uses the real /join/<slug> URL
// - Storefront stats (views/conversion) come from booking.revenue or
//   placeholder 0 — analytics infra isn't in place yet

import { type ReactNode, useState } from "react";

import { NewProductModal } from "./new-product-modal";
import { Avatar, Icon } from "./primitives";

export type StoreProduct = {
  id: string;
  name: string;
  type: string; // mix | master | production | consult
  price: number;
  currency: string;
  duration: string;
  sessions: number;
  visible: boolean;
  featured: boolean;
};

export type StoreProducer = {
  name: string;
  tagline: string;
  publicLinkSlug: string;
  publicLinkPrefix: string; // e.g. "skitza.app/p/"
};

export type StoreStats = {
  views7d: number;
  views7dDelta: number;
  bookings7d: number;
  bookings7dDelta: number;
  conversion: number;
};

type StorefrontData = {
  producer: StoreProducer;
  products: StoreProduct[];
  stats: StoreStats;
};

export function StorefrontTab({ data }: { data: StorefrontData }) {
  const [tab, setTab] = useState<"store" | "portfolio" | "profile">("store");
  const [published, setPublished] = useState(true);
  const [productOverrides, setProductOverrides] = useState<
    Record<string, { visible?: boolean; featured?: boolean }>
  >({});
  const [newProductOpen, setNewProductOpen] = useState(false);
  const isVisible = (p: StoreProduct): boolean =>
    productOverrides[p.id]?.visible ?? p.visible;
  const isFeatured = (p: StoreProduct): boolean =>
    productOverrides[p.id]?.featured ?? p.featured;

  return (
    <div
      data-screen-label="05 Storefront"
      className="custom-scrollbar"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 3vw, 32px)",
        maxWidth: 1180,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <header
        className="reveal-up stagger-1"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="label-tiny" style={{ display: "block", marginBottom: 6 }}>
            Public Page
          </span>
          <h1
            className="font-syne"
            style={{
              fontSize: "clamp(34px, 4.5vw, 52px)",
              fontWeight: 800,
              letterSpacing: "-0.035em",
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Storefront
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "rgb(var(--fg-muted))" }}>
            What artists see at{" "}
            <span
              style={{
                color: "rgb(var(--brand-primary))",
                fontWeight: 600,
                fontFamily: "JetBrains Mono",
              }}
            >
              {data.producer.publicLinkPrefix}
              {data.producer.publicLinkSlug}
            </span>
          </p>
        </div>
        <button
          className="sk-pop"
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "8px 14px",
            borderRadius: 9,
            background: "rgb(var(--fg-default))",
            color: "rgb(var(--bg-background))",
            fontSize: 12.5,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="external-link" size={13} /> Preview
        </button>
      </header>

      <div className="reveal-up stagger-2" style={{ marginBottom: 14 }}>
        <PublicLinkStrip
          producer={data.producer}
          published={published}
          onPublishedChange={setPublished}
          stats={data.stats}
        />
      </div>

      <nav
        className="reveal-up stagger-2"
        style={{
          display: "inline-flex",
          padding: 4,
          borderRadius: 10,
          background: "rgb(var(--bg-elevated))",
          border: "1px solid rgb(var(--border-subtle))",
          marginBottom: 14,
        }}
      >
        {(
          [
            ["store", "Products"],
            ["portfolio", "Portfolio"],
            ["profile", "Profile"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "7px 16px",
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 700,
              background: tab === k ? "rgb(var(--bg-background))" : "transparent",
              color: tab === k ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
            }}
          >
            {l}
          </button>
        ))}
      </nav>

      <div className="reveal-up stagger-3">
        {tab === "store" && (
          <ProductsGrid
            products={data.products}
            isVisible={isVisible}
            isFeatured={isFeatured}
            onAddNew={() => setNewProductOpen(true)}
            toggleVisible={(id) =>
              setProductOverrides((p) => ({
                ...p,
                [id]: {
                  ...p[id],
                  visible: !(p[id]?.visible ?? data.products.find((x) => x.id === id)?.visible ?? true),
                },
              }))
            }
          />
        )}
        {tab === "portfolio" && <PortfolioGrid />}
        {tab === "profile" && <ProfileGrid producer={data.producer} />}
      </div>
      <NewProductModal open={newProductOpen} onClose={() => setNewProductOpen(false)} />
    </div>
  );
}

function PublicLinkStrip({
  producer,
  published,
  onPublishedChange,
  stats,
}: {
  producer: StoreProducer;
  published: boolean;
  onPublishedChange: (b: boolean) => void;
  stats: StoreStats;
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "rgb(var(--bg-sidebar))",
        borderRadius: 18,
        padding: 18,
        color: "#fff",
        border: "1px solid rgb(var(--border-sidebar))",
      }}
    >
      <div className="animate-shine" />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="globe" size={18} style={{ color: "rgb(var(--brand-primary))" }} strokeWidth={2.4} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "rgba(255,255,255,0.45)",
                marginBottom: 2,
              }}
            >
              {published ? "Live" : "Hidden"}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.55)",
                lineHeight: 1.3,
              }}
            >
              {published
                ? "Visitors can land, listen, and book here."
                : "Hidden from the world — toggle to publish."}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 11.5,
            color: "rgba(255,255,255,0.7)",
            fontFamily: "JetBrains Mono",
          }}
        >
          <span>{stats.views7d.toLocaleString()} views · 7d</span>
          <span>·</span>
          <span>{stats.bookings7d} bookings</span>
          <span>·</span>
          <span>{stats.conversion}% conv.</span>
          <button
            onClick={() => onPublishedChange(!published)}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 11.5,
              fontWeight: 700,
              background: published ? "rgb(var(--fg-success))" : "rgb(var(--brand-primary))",
              color: published ? "#fff" : "#111009",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon name={published ? "check" : "send"} size={12} strokeWidth={2.6} />
            {published ? "Published" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductsGrid({
  products,
  isVisible,
  isFeatured,
  toggleVisible,
  onAddNew,
}: {
  products: StoreProduct[];
  isVisible: (p: StoreProduct) => boolean;
  isFeatured: (p: StoreProduct) => boolean;
  onAddNew: () => void;
  toggleVisible: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {products.map((p) => {
        const visible = isVisible(p);
        return (
          <div
            key={p.id}
            className="surface-card"
            style={{ padding: 16, opacity: visible ? 1 : 0.55 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span
                className="pill"
                style={{
                  fontSize: 9.5,
                  background: "rgb(var(--bg-elevated))",
                  color: "rgb(var(--fg-default))",
                  border: "1px solid rgb(var(--border-subtle))",
                }}
              >
                {p.type.toUpperCase()}
                {isFeatured(p) && " · ★"}
              </span>
              <button
                onClick={() => toggleVisible(p.id)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: visible ? "rgb(var(--fg-success))" : "rgb(var(--fg-faint))",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: visible ? "rgb(var(--fg-success))" : "rgb(var(--fg-faint))",
                  }}
                />
                {visible ? "LIVE" : "HIDDEN"}
              </button>
            </div>
            <h3
              className="font-syne"
              style={{
                margin: "0 0 6px",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "-0.015em",
              }}
            >
              {p.name}
            </h3>
            <p style={{ margin: 0, fontSize: 11.5, color: "rgb(var(--fg-muted))" }}>
              {p.duration} · {p.sessions} session{p.sessions > 1 ? "s" : ""}
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginTop: 14,
              }}
            >
              <span
                className="tabular"
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  fontFamily: "JetBrains Mono",
                  letterSpacing: "-0.02em",
                }}
              >
                ${p.price}
              </span>
              <button
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "rgb(var(--fg-muted))",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                Edit →
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAddNew}
        className="sk-pop sk-row"
        style={{
          all: "unset",
          cursor: "pointer",
          borderRadius: 14,
          border: "2px dashed rgb(var(--border-strong))",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          minHeight: 152,
          color: "rgb(var(--fg-muted))",
        }}
      >
        <Icon name="plus" size={20} style={{ marginBottom: 6 }} />
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>Add new product</span>
        <span style={{ fontSize: 10.5, marginTop: 2 }}>Title, length, price</span>
      </button>
    </div>
  );
}

function PortfolioGrid(): ReactNode {
  // Empty state — Skitza doesn't curate a portfolio yet.
  return (
    <div
      className="surface-card"
      style={{ padding: 60, textAlign: "center", color: "rgb(var(--fg-muted))" }}
    >
      <Icon name="disc-3" size={28} style={{ marginBottom: 10, color: "rgb(var(--fg-faint))" }} />
      <div style={{ fontSize: 14, fontWeight: 700 }}>Add your portfolio</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        Pin tracks from your Music Library to feature them on the public page.
      </div>
    </div>
  );
}

function ProfileGrid({ producer }: { producer: StoreProducer }) {
  const initials =
    producer.name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "GS";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      <div className="surface-card">
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid rgb(var(--border-subtle) / 0.7)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="user" size={14} style={{ color: "rgb(var(--fg-muted))" }} />
          <h3
            className="font-syne"
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            Identity
          </h3>
        </header>
        <div style={{ padding: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <Avatar initials={initials} grad="grad-amber" size={56} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{producer.name}</div>
              <div style={{ fontSize: 11.5, color: "rgb(var(--fg-muted))" }}>
                {producer.tagline || "Add a tagline in Settings"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ["Display name", producer.name],
              ["Tagline", producer.tagline || "—"],
              ["Public link", `${producer.publicLinkPrefix}${producer.publicLinkSlug}`],
            ].map(([l, v]) => (
              <div
                key={l}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgb(var(--bg-elevated))",
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: "rgb(var(--fg-muted))" }}>{l}</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="surface-card">
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid rgb(var(--border-subtle) / 0.7)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="link" size={14} style={{ color: "rgb(var(--fg-muted))" }} />
          <h3
            className="font-syne"
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            Social Links
          </h3>
        </header>
        <div
          style={{
            padding: 14,
            fontSize: 12,
            color: "rgb(var(--fg-muted))",
            textAlign: "center",
          }}
        >
          Add Instagram, Spotify, SoundCloud links in Settings →
        </div>
      </div>
    </div>
  );
}
