"use client";

import {
  AlertCircle,
  ContactRound,
  CreditCard,
  FileText,
  FolderKanban,
  Mail,
  NotebookPen,
  Phone,
  Plus,
  Send,
  Tag,
  UserRoundCheck,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { sendClientInviteAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";
import {
  loadClientPrivateOffersAction,
  type ClientPrivateOfferSummary,
} from "~/app/(producer)/dashboard/store/private-offer-actions";
import {
  PrivateOfferComposer,
  type PrivateOfferComposerRecipient,
  type PrivateOfferCurrency,
} from "~/components/dashboard/offers/private-offer-composer";
import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { ProducerPaymentWorkspace } from "~/components/payments/producer-payment-workspace";
import type { PaymentWorkspaceBucket } from "~/components/payments/producer-payment-workspace-model";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";
import { nextTabIndex } from "~/lib/keyboard/tab-navigation";
import type { TaxMode } from "~/lib/tax-mode";

import { ClientActionsMenu } from "./client-actions-menu";
import { ClientArchiveConfirmModal } from "./client-archive-confirm-modal";
import {
  ClientSpaceProjectRow,
  isArchivedClientSpaceProject,
  type ClientSpaceProjectData,
} from "./client-space-project-row";
import { EditClientModal } from "./edit-client-modal";
import { InviteToAppModal } from "./invite-modal";
import { LinkPill, type LinkPillState } from "./link-pill";
import { NewProjectModal } from "./new-project-modal";
import { RemoveClientConfirmModal } from "./remove-client-confirm-modal";

export type ClientSpaceTab = "projects" | "payments" | "details";

const CLIENT_SPACE_TABS: readonly ClientSpaceTab[] = ["projects", "payments", "details"];

const TAB_LABEL: Record<ClientSpaceTab, string> = {
  projects: "Projects",
  payments: "Payments",
  details: "Details",
};

const OFFER_STATUS_LABEL: Record<ClientPrivateOfferSummary["status"], string> = {
  draft: "Draft",
  sent: "Waiting for artist",
  accepted: "Accepted",
  declined: "Rejected",
  expired: "Expired",
  canceled: "Canceled",
};

export interface ClientSpaceClientData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  tags: string[];
  archived: boolean;
  archiveBlockedReason: string | null;
  canPermanentlyDelete: boolean;
  linkState: LinkPillState;
  joinedAtIso: string;
}

export interface ClientSpacePaymentTotal {
  currency: string;
  dueNowCents: number;
  totalRemainingCents: number;
}

export interface ClientSpaceOfferConfig {
  defaultCurrency: PrivateOfferCurrency;
  taxMode: TaxMode;
  taxRatePct: number;
}

interface ClientSpaceWorkspaceProps {
  client: ClientSpaceClientData;
  projects: ClientSpaceProjectData[];
  paymentBuckets: readonly PaymentWorkspaceBucket[];
  paymentTotals: readonly ClientSpacePaymentTotal[];
  needsReviewCount: number;
  producerSlug: string;
  offerConfig: ClientSpaceOfferConfig | null;
}

type OfferHistoryState =
  | { status: "idle"; offers: ClientPrivateOfferSummary[] }
  | { status: "loading"; offers: ClientPrivateOfferSummary[] }
  | { status: "loaded"; offers: ClientPrivateOfferSummary[] }
  | { status: "error"; offers: ClientPrivateOfferSummary[]; message: string };

const EMPTY_OFFER_HISTORY: OfferHistoryState = { status: "idle", offers: [] };

export function ClientSpaceWorkspace({
  client,
  projects,
  paymentBuckets,
  paymentTotals,
  needsReviewCount,
  producerSlug,
  offerConfig,
}: ClientSpaceWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<ClientSpaceTab>("projects");
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newOfferOpen, setNewOfferOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [offerHistory, setOfferHistory] = useState<OfferHistoryState>(EMPTY_OFFER_HISTORY);
  const [offerReload, setOfferReload] = useState(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const actionReturnFocusRef = useRef<HTMLElement | null>(null);
  const launchingAddActionRef = useRef(false);
  const offerHistoryClientIdRef = useRef(client.id);
  const offerRequestKeyRef = useRef<string | null>(null);
  const offerRequestGenerationRef = useRef(0);
  const online = useOnlineStatus();
  const { toast } = useToast();
  const [resendPending, startResendTransition] = useTransition();
  const tabSwipeHandlers = useTabSwipe({
    items: CLIENT_SPACE_TABS,
    value: activeTab,
    onChange: setActiveTab,
  });

  const activeProjects = useMemo(
    () => projects.filter((project) => !isArchivedClientSpaceProject(project)),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => isArchivedClientSpaceProject(project)),
    [projects],
  );
  const visibleProjects = showArchived ? archivedProjects : activeProjects;
  const canCreateWork = !client.archived && Boolean(client.email);
  const canCreateOffer = canCreateWork && offerConfig !== null;
  const canInvite = client.linkState === "none" && producerSlug.length > 0;
  const visibleOfferHistory =
    offerHistoryClientIdRef.current === client.id ? offerHistory : EMPTY_OFFER_HISTORY;
  const offerRecipients = useMemo<PrivateOfferComposerRecipient[]>(
    () =>
      client.email
        ? [
            {
              id: client.id,
              name: client.name,
              email: client.email,
              projects: projects
                .filter(
                  (project) =>
                    project.lifecycleStatus === "waiting_for_payment" ||
                    project.lifecycleStatus === "active",
                )
                .map((project) => ({ id: project.id, title: project.title })),
            },
          ]
        : [],
    [client.email, client.id, client.name, projects],
  );

  useEffect(() => {
    const clientChanged = offerHistoryClientIdRef.current !== client.id;
    if (clientChanged) {
      // Hide the previous client's history immediately and invalidate its
      // pending generation before this client can start a request.
      offerHistoryClientIdRef.current = client.id;
      offerRequestGenerationRef.current += 1;
      offerRequestKeyRef.current = null;
      if (activeTab !== "details") {
        setOfferHistory(EMPTY_OFFER_HISTORY);
        return;
      }
    }
    if (activeTab !== "details") return;
    const requestKey = `${client.id}:${String(offerReload)}`;
    if (offerRequestKeyRef.current === requestKey) return;
    offerRequestKeyRef.current = requestKey;
    const requestGeneration = offerRequestGenerationRef.current + 1;
    offerRequestGenerationRef.current = requestGeneration;
    setOfferHistory((current) => ({
      status: "loading",
      offers: clientChanged ? [] : current.offers,
    }));
    void loadClientPrivateOffersAction(client.id)
      .then((result) => {
        if (
          offerRequestKeyRef.current !== requestKey ||
          offerRequestGenerationRef.current !== requestGeneration
        ) {
          return;
        }
        if (!result.ok) {
          setOfferHistory((current) => ({
            status: "error",
            offers: current.offers,
            message: result.error,
          }));
          return;
        }
        setOfferHistory({ status: "loaded", offers: result.data });
      })
      .catch(() => {
        if (
          offerRequestKeyRef.current !== requestKey ||
          offerRequestGenerationRef.current !== requestGeneration
        ) {
          return;
        }
        setOfferHistory((current) => ({
          status: "error",
          offers: current.offers,
          message: "Could not load private offers. Try again.",
        }));
      });
  }, [activeTab, client.id, offerReload]);

  function refreshOfferHistory() {
    // Invalidate synchronously so an older producer-wide request cannot win
    // before React starts the replacement generation.
    offerRequestGenerationRef.current += 1;
    offerRequestKeyRef.current = null;
    setOfferHistory((current) => ({ status: "loading", offers: current.offers }));
    setOfferReload((value) => value + 1);
  }

  function rememberCurrentFocus() {
    if (document.activeElement instanceof HTMLElement) {
      actionReturnFocusRef.current = document.activeElement;
    }
  }

  function launchAddAction(action: "project" | "offer") {
    actionReturnFocusRef.current = addButtonRef.current;
    launchingAddActionRef.current = true;
    setAddOpen(false);
    window.setTimeout(() => {
      if (action === "project") {
        setNewProjectOpen(true);
      } else {
        setNewOfferOpen(true);
      }
    }, 0);
  }

  function resendInvite() {
    if (!online) {
      toast("Reconnect to resend this invite.", "error");
      return;
    }
    startResendTransition(async () => {
      try {
        const result = await sendClientInviteAction({ id: client.id, via: "email" });
        if (!result.ok) {
          toast(result.error, "error");
          return;
        }
        toast("Invite re-sent", "success");
      } catch {
        toast("Could not resend this invite. Try again.", "error");
      }
    });
  }

  const attentionCopy = paymentAttentionCopy(paymentTotals, needsReviewCount);

  return (
    <div className="min-w-0">
      <CompactClientHeader
        client={client}
        attentionCopy={attentionCopy}
        resendPending={resendPending}
        onResend={resendInvite}
        {...(canInvite
          ? {
              onInvite: () => {
                rememberCurrentFocus();
                setInviteOpen(true);
              },
            }
          : {})}
        onPayments={() => {
          setActiveTab("payments");
        }}
        onAdd={() => {
          actionReturnFocusRef.current = addButtonRef.current;
          setAddOpen(true);
        }}
        addButtonRef={addButtonRef}
        onEdit={() => {
          setEditOpen(true);
        }}
        onArchive={() => {
          setArchiveOpen(true);
        }}
        onDelete={
          client.canPermanentlyDelete
            ? () => {
                setRemoveOpen(true);
              }
            : undefined
        }
        onActionStart={(trigger) => {
          actionReturnFocusRef.current = trigger;
        }}
      />

      <div className="sticky top-0 z-30 -mx-4 mt-4 border-y border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.96)] px-4 py-2 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:top-16 lg:-mx-8 lg:px-8">
        <div
          role="tablist"
          aria-label="Client sections"
          className="mx-auto grid w-full max-w-[760px] grid-cols-3 gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 shadow-[var(--shadow-sm)]"
        >
          {CLIENT_SPACE_TABS.map((tab, index) => {
            const selected = activeTab === tab;
            const Icon =
              tab === "projects" ? FolderKanban : tab === "payments" ? CreditCard : ContactRound;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`client-space-tab-${tab}`}
                aria-selected={selected}
                aria-controls={`client-space-panel-${tab}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setActiveTab(tab);
                }}
                onKeyDown={(event) => {
                  const nextIndex = nextTabIndex(index, CLIENT_SPACE_TABS.length, event.key);
                  if (nextIndex === null) return;
                  const next = CLIENT_SPACE_TABS[nextIndex];
                  if (!next) return;
                  event.preventDefault();
                  setActiveTab(next);
                  document.getElementById(`client-space-tab-${next}`)?.focus();
                }}
                className={[
                  "sk-press inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-2 text-[12px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none motion-reduce:transition-none sm:px-4",
                  selected
                    ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                    : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]",
                ].join(" ")}
              >
                <Icon size={14} aria-hidden />
                <span className="truncate">{TAB_LABEL[tab]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-tab-swipe-surface
        className="mt-4 [touch-action:pan-y_pinch-zoom]"
        {...tabSwipeHandlers}
      >
        <div
          data-tab-swipe-panel
          role="tabpanel"
          id={`client-space-panel-${activeTab}`}
          aria-labelledby={`client-space-tab-${activeTab}`}
          tabIndex={0}
          className="min-w-0 rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
        >
          {activeTab === "projects" ? (
            <ProjectsPanel
              activeProjects={activeProjects}
              archivedProjects={archivedProjects}
              visibleProjects={visibleProjects}
              showArchived={showArchived}
              onShowArchived={setShowArchived}
            />
          ) : null}
          {activeTab === "payments" ? (
            <PaymentsPanel clientName={client.name} paymentBuckets={paymentBuckets} />
          ) : null}
          {activeTab === "details" ? (
            <DetailsPanel
              client={client}
              offers={visibleOfferHistory}
              onEdit={() => {
                rememberCurrentFocus();
                setEditOpen(true);
              }}
              onRetryOffers={refreshOfferHistory}
            />
          ) : null}
        </div>
      </div>

      <Sheet
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
        }}
      >
        <SheetContent
          side="bottom"
          data-testid="client-add-sheet"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (launchingAddActionRef.current) {
              launchingAddActionRef.current = false;
              return;
            }
            addButtonRef.current?.focus();
          }}
          className="gap-2 sm:right-6 sm:bottom-6 sm:left-auto sm:w-[360px] sm:rounded-[var(--radius-xl)]"
        >
          <SheetTitle>Add for {client.name}</SheetTitle>
          <SheetDescription>Create new work without leaving this client space.</SheetDescription>
          <div role="group" aria-label={`Add for ${client.name}`} className="mt-2 grid gap-2">
            <AddActionButton
              icon={FolderKanban}
              label="New Project"
              detail={addDisabledReason(client, offerConfig, "project")}
              disabled={!canCreateWork}
              onClick={() => {
                launchAddAction("project");
              }}
            />
            <AddActionButton
              icon={Send}
              label="New Offer"
              detail={addDisabledReason(client, offerConfig, "offer")}
              disabled={!canCreateOffer}
              onClick={() => {
                launchAddAction("offer");
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => {
          setNewProjectOpen(false);
        }}
        clients={[]}
        lockedClient={{
          id: client.id,
          name: client.name,
          email: client.email ?? "",
        }}
        onCreated={() => {
          setNewProjectOpen(false);
        }}
        returnFocusRef={actionReturnFocusRef}
      />

      {offerConfig && client.email ? (
        <PrivateOfferComposer
          recipients={offerRecipients}
          lockedClientId={client.id}
          defaultCurrency={offerConfig.defaultCurrency}
          taxMode={offerConfig.taxMode}
          taxRatePct={offerConfig.taxRatePct}
          open={newOfferOpen}
          onOpenChange={setNewOfferOpen}
          onCreated={refreshOfferHistory}
          trigger={null}
          returnFocusRef={actionReturnFocusRef}
        />
      ) : null}

      {canInvite ? (
        <InviteToAppModal
          open={inviteOpen}
          onClose={() => {
            setInviteOpen(false);
          }}
          client={{
            id: client.id,
            name: client.name,
            email: client.email,
            gradient: producerGradient(client.name),
          }}
          producerSlug={producerSlug}
          returnFocusRef={actionReturnFocusRef}
        />
      ) : null}

      <EditClientModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
        }}
        client={{
          id: client.id,
          name: client.name,
          email: client.email ?? "",
          phone: client.phone,
          notes: client.notes,
          tags: client.tags,
        }}
        returnFocusRef={actionReturnFocusRef}
      />

      <ClientArchiveConfirmModal
        open={archiveOpen}
        onClose={() => {
          setArchiveOpen(false);
        }}
        client={{ id: client.id, name: client.name, archived: client.archived }}
        blockedReason={client.archiveBlockedReason}
        returnFocusRef={actionReturnFocusRef}
      />

      {client.canPermanentlyDelete ? (
        <RemoveClientConfirmModal
          open={removeOpen}
          onClose={() => {
            setRemoveOpen(false);
          }}
          client={{ id: client.id, name: client.name }}
          returnFocusRef={actionReturnFocusRef}
        />
      ) : null}
    </div>
  );
}

function CompactClientHeader({
  client,
  attentionCopy,
  resendPending,
  onResend,
  onInvite,
  onPayments,
  onAdd,
  addButtonRef,
  onEdit,
  onArchive,
  onDelete,
  onActionStart,
}: {
  client: ClientSpaceClientData;
  attentionCopy: string | null;
  resendPending: boolean;
  onResend: () => void;
  onInvite?: (() => void) | undefined;
  onPayments: () => void;
  onAdd: () => void;
  addButtonRef: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
  onArchive: () => void;
  onDelete?: (() => void) | undefined;
  onActionStart: (trigger: HTMLButtonElement) => void;
}) {
  const avatarBackground = producerGradient(client.name);

  return (
    <header
      aria-label={`Client space for ${client.name}`}
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)] sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="font-display flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[17px] font-extrabold text-white shadow-sm"
          style={{ background: avatarBackground }}
        >
          {producerInitials(client.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="font-display min-w-0 truncate text-[24px] leading-tight font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-[28px]">
              {client.name}
            </h1>
            {client.linkState === "none" ? (
              onInvite ? (
                <LinkPill state="none" onInvite={onInvite} />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2.5 py-1 text-[10px] font-bold tracking-[0.09em] text-[rgb(var(--fg-muted))] uppercase">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--fg-muted))]"
                  />
                  Not connected
                </span>
              )
            ) : (
              <LinkPill state={client.linkState} />
            )}
            {client.archived ? (
              <span className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-1 text-[10px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
                Archived
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[rgb(var(--fg-muted))]">
            {client.email ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Mail size={12} aria-hidden />
                <span className="max-w-[220px] truncate">{client.email}</span>
              </span>
            ) : (
              <span>No email saved</span>
            )}
            {client.linkState === "pending" ? (
              <button
                type="button"
                onClick={onResend}
                disabled={resendPending}
                className="min-h-11 font-semibold text-[rgb(var(--brand-primary-text))] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50 sm:min-h-0"
              >
                {resendPending ? "Resending…" : "Resend invite"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            ref={addButtonRef}
            type="button"
            aria-label={`Add for ${client.name}`}
            onClick={onAdd}
            className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))] shadow-sm focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
          >
            <Plus size={18} strokeWidth={2.4} aria-hidden />
          </button>
          <ClientActionsMenu
            name={client.name}
            archived={client.archived}
            onEdit={onEdit}
            onArchive={onArchive}
            onDelete={onDelete}
            onActionStart={onActionStart}
          />
        </div>
      </div>

      {attentionCopy ? (
        <button
          type="button"
          onClick={onPayments}
          className="sk-press mt-4 flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.09)] px-3 py-2.5 text-left text-[12px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          <AlertCircle size={16} aria-hidden className="shrink-0 text-[rgb(var(--fg-warning))]" />
          <span className="min-w-0 flex-1">{attentionCopy}</span>
          <span className="shrink-0 text-[11px] text-[rgb(var(--brand-primary-text))]">
            Payments
          </span>
        </button>
      ) : null}
    </header>
  );
}

function ProjectsPanel({
  activeProjects,
  archivedProjects,
  visibleProjects,
  showArchived,
  onShowArchived,
}: {
  activeProjects: ClientSpaceProjectData[];
  archivedProjects: ClientSpaceProjectData[];
  visibleProjects: ClientSpaceProjectData[];
  showArchived: boolean;
  onShowArchived: (show: boolean) => void;
}) {
  const activeFilterRef = useRef<HTMLButtonElement>(null);
  const archivedFilterRef = useRef<HTMLButtonElement>(null);

  return (
    <section aria-labelledby="client-projects-heading" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
            Work
          </p>
          <h2
            id="client-projects-heading"
            className="font-display text-[20px] font-extrabold text-[rgb(var(--fg-default))]"
          >
            {showArchived ? "Archived projects" : "Active projects"}
          </h2>
        </div>
        <div
          role="group"
          aria-label="Project status filter"
          className="inline-flex rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1"
        >
          <ProjectFilterButton
            buttonRef={activeFilterRef}
            label="Active"
            count={activeProjects.length}
            pressed={!showArchived}
            onClick={() => {
              onShowArchived(false);
            }}
          />
          <ProjectFilterButton
            buttonRef={archivedFilterRef}
            label="Archived"
            count={archivedProjects.length}
            pressed={showArchived}
            onClick={() => {
              onShowArchived(true);
            }}
          />
        </div>
      </div>

      {visibleProjects.length === 0 ? (
        <div
          role="status"
          className="mt-3 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-9 text-center"
        >
          <p className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
            {showArchived ? "No archived projects" : "No active projects"}
          </p>
          <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
            {showArchived
              ? "Completed and canceled projects will stay available here."
              : "Use the + action above to create this client’s first project."}
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid min-w-0 gap-2">
          {visibleProjects.map((project) => (
            <ClientSpaceProjectRow
              key={project.id}
              project={project}
              lifecycleSuccessFocusRef={showArchived ? activeFilterRef : archivedFilterRef}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectFilterButton({
  buttonRef,
  label,
  count,
  pressed,
  onClick,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={[
        "sk-press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-lg)] px-3 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
        pressed
          ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
          : "text-[rgb(var(--fg-muted))]",
      ].join(" ")}
    >
      {label}
      <span className="font-mono text-[9px] opacity-70">{String(count)}</span>
    </button>
  );
}

function PaymentsPanel({
  clientName,
  paymentBuckets,
}: {
  clientName: string;
  paymentBuckets: readonly PaymentWorkspaceBucket[];
}) {
  return (
    <section aria-labelledby="client-payments-heading" className="min-w-0">
      <header className="mb-3">
        <p className="text-[10px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
          Money
        </p>
        <h2
          id="client-payments-heading"
          className="font-display text-[20px] font-extrabold text-[rgb(var(--fg-default))]"
        >
          Payments
        </h2>
      </header>
      <ProducerPaymentWorkspace
        buckets={paymentBuckets}
        scope="client"
        clientLabel={clientName}
        defaultView="open"
        presentation="client-tab"
      />
    </section>
  );
}

function DetailsPanel({
  client,
  offers,
  onEdit,
  onRetryOffers,
}: {
  client: ClientSpaceClientData;
  offers: OfferHistoryState;
  onEdit: () => void;
  onRetryOffers: () => void;
}) {
  return (
    <section aria-labelledby="client-details-heading" className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
            Client record
          </p>
          <h2
            id="client-details-heading"
            className="font-display text-[20px] font-extrabold text-[rgb(var(--fg-default))]"
          >
            Details
          </h2>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[12px] font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          <NotebookPen size={14} aria-hidden />
          Edit
        </button>
      </div>

      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        <DetailCard icon={ContactRound} title="Contact information">
          <dl className="grid gap-3 text-[12px]">
            <DetailValue label="Email" value={client.email ?? "Not added"} icon={Mail} />
            <DetailValue label="Phone" value={client.phone ?? "Not added"} icon={Phone} />
            <DetailValue label="Added" value={formatDate(client.joinedAtIso)} />
          </dl>
        </DetailCard>

        <DetailCard icon={UserRoundCheck} title="Connection status">
          <p className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
            {connectionLabel(client.linkState)}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {connectionDetail(client.linkState)}
          </p>
        </DetailCard>

        <DetailCard icon={FileText} title="Private notes">
          <p className="max-w-full min-w-0 text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
            {client.notes?.trim() || "No private notes yet."}
          </p>
        </DetailCard>

        <DetailCard icon={Tag} title="Tags">
          {client.tags.length > 0 ? (
            <ul className="flex max-w-full min-w-0 flex-wrap gap-2">
              {client.tags.map((tag) => (
                <li
                  key={tag}
                  data-testid="client-detail-tag"
                  className="max-w-full min-w-0 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-1 text-[11px] font-semibold [overflow-wrap:anywhere] break-words whitespace-normal text-[rgb(var(--fg-secondary))]"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[rgb(var(--fg-muted))]">No tags yet.</p>
          )}
        </DetailCard>
      </div>

      <div className="mt-3">
        <DetailCard icon={Send} title="Private offers">
          {(offers.status === "idle" || offers.status === "loading") &&
          offers.offers.length === 0 ? (
            <p role="status" className="text-[13px] text-[rgb(var(--fg-muted))]">
              Loading private offers…
            </p>
          ) : null}
          {offers.status === "loading" && offers.offers.length > 0 ? (
            <p role="status" className="mb-2 text-[12px] text-[rgb(var(--fg-muted))]">
              Refreshing private offers…
            </p>
          ) : null}
          {offers.status === "error" ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-[13px] break-words text-[rgb(var(--fg-danger-text))]">
                {offers.message}
              </p>
              <button
                type="button"
                onClick={onRetryOffers}
                className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold text-[rgb(var(--fg-default))]"
              >
                Try again
              </button>
            </div>
          ) : null}
          {offers.status === "loaded" && offers.offers.length === 0 ? (
            <p className="text-[13px] text-[rgb(var(--fg-muted))]">No private offers yet.</p>
          ) : null}
          {offers.offers.length > 0 ? (
            <ul className="max-w-full min-w-0 divide-y divide-[rgb(var(--border-subtle))]">
              {offers.offers.map((offer) => (
                <li
                  key={offer.id}
                  className="flex max-w-full min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="max-w-full min-w-0 flex-1">
                    <p className="max-w-full min-w-0 text-[13px] font-extrabold [overflow-wrap:anywhere] break-words whitespace-normal text-[rgb(var(--fg-default))]">
                      {offer.name}
                    </p>
                    <p
                      data-testid="client-offer-metadata"
                      className="mt-0.5 max-w-full min-w-0 text-[11px] [overflow-wrap:anywhere] break-words whitespace-normal text-[rgb(var(--fg-muted))]"
                    >
                      {OFFER_STATUS_LABEL[offer.status]} ·{" "}
                      {offer.targetProjectTitle ?? "New project"} · Expires{" "}
                      {formatDate(offer.expiresAtIso)}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[12px] font-bold text-[rgb(var(--fg-default))]">
                    {formatMoney(offer.totalCents, offer.currency, { withCents: true })}{" "}
                    <span className="text-[9px] text-[rgb(var(--fg-muted))]">{offer.currency}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </DetailCard>
      </div>
    </section>
  );
}

function DetailCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ContactRound;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="max-w-full min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[12px] font-extrabold tracking-[0.02em] text-[rgb(var(--fg-default))]">
        <Icon size={15} aria-hidden className="text-[rgb(var(--brand-primary-text))]" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function DetailValue({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Mail;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[10px] font-bold tracking-[0.09em] text-[rgb(var(--fg-muted))] uppercase">
        {Icon ? <Icon size={11} aria-hidden /> : null}
        {label}
      </dt>
      <dd className="mt-0.5 max-w-full min-w-0 text-[13px] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
        {value}
      </dd>
    </div>
  );
}

function AddActionButton({
  icon: Icon,
  label,
  detail,
  disabled,
  onClick,
}: {
  icon: typeof FolderKanban;
  label: string;
  detail: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="sk-press flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]">
        <Icon size={17} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-extrabold text-[rgb(var(--fg-default))]">
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
          {detail}
        </span>
      </span>
    </button>
  );
}

function paymentAttentionCopy(
  totals: readonly ClientSpacePaymentTotal[],
  needsReviewCount: number,
): string | null {
  const due = totals.filter((total) => total.dueNowCents > 0);
  if (due.length === 0 && needsReviewCount === 0) return null;

  const dueCopy = due
    .map(
      (total) =>
        `${formatMoney(total.dueNowCents, total.currency, { withCents: true })} ${total.currency}`,
    )
    .join(" · ");
  const proofCopy =
    needsReviewCount > 0
      ? `${String(needsReviewCount)} payment ${needsReviewCount === 1 ? "proof" : "proofs"} to review`
      : "";

  if (dueCopy && proofCopy) return `${dueCopy} due · ${proofCopy}`;
  if (dueCopy) return `${dueCopy} due now`;
  return proofCopy;
}

function addDisabledReason(
  client: ClientSpaceClientData,
  offerConfig: ClientSpaceOfferConfig | null,
  action: "project" | "offer",
): string {
  if (client.archived) return "Restore this client before creating new work.";
  if (!client.email) return "Add an email before creating new work.";
  if (action === "offer" && !offerConfig) return "Producer offer settings are unavailable.";
  return action === "project"
    ? "Create a project connected to this client."
    : "Send private terms to this client.";
}

function connectionLabel(state: LinkPillState): string {
  if (state === "active") return "Linked to the artist app";
  if (state === "pending") return "Invitation pending";
  return "Not connected";
}

function connectionDetail(state: LinkPillState): string {
  if (state === "active") {
    return "This client has an active artist account connected to this producer.";
  }
  if (state === "pending") {
    return "An invitation was sent and is waiting for the client to sign in.";
  }
  return "Invite this client from the connection control in the header.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
