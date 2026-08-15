"use client";

import {
  ArrowRight,
  CalendarSync,
  Check,
  CircleAlert,
  Loader2,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

import {
  canUseAsGoogleCalendarDestination,
  findGoogleCalendarOption,
  googleCalendarAccessRoleLabel,
  type GoogleCalendarActionFailureReason,
  type GoogleCalendarActionResult,
  type GoogleCalendarControlActions,
  type GoogleCalendarOption,
  type GoogleCalendarSelection,
  type GoogleCalendarSyncIssueIdentity,
  type GoogleCalendarSyncSummary,
  type GoogleCalendarUiModel,
} from "./google-calendar-ui-model";

export type GoogleCalendarControlView =
  | "summary"
  | "selection"
  | "destination_selection"
  | "busy_selection"
  | "switch_confirmation"
  | "disconnect_confirmation";
type PendingAction = keyof GoogleCalendarControlActions;

export type GoogleCalendarControlProps = Readonly<{
  model: GoogleCalendarUiModel;
  actions: GoogleCalendarControlActions;
  timeZone?: string;
  open?: boolean;
  defaultOpen?: boolean;
  defaultView?: GoogleCalendarControlView;
  onOpenChange?: (open: boolean) => void;
}>;

export function GoogleCalendarControl({
  model,
  actions,
  timeZone = "UTC",
  open,
  defaultOpen,
  defaultView,
  onOpenChange,
}: GoogleCalendarControlProps) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? shouldOpenAutomatically(model));
  const [view, setView] = useState<GoogleCalendarControlView>(
    () => defaultView ?? initialView(model),
  );
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dismissedIssueKeys, setDismissedIssueKeys] = useState<readonly string[]>([]);
  const [clearingIssueKey, setClearingIssueKey] = useState<string | null>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);

  const initialSelection = selectionFromModel(model);
  const [destinationSelectionKey, setDestinationSelectionKey] = useState<string | null>(
    initialSelection?.destinationSelectionKey ?? null,
  );
  const [busySelectionKeys, setBusySelectionKeys] = useState<readonly string[]>(
    initialSelection?.busySelectionKeys ?? [],
  );

  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    const selection = selectionFromModel(model);
    setDestinationSelectionKey(selection?.destinationSelectionKey ?? null);
    setBusySelectionKeys(selection?.busySelectionKeys ?? []);
    setFeedback(null);
    setView(defaultView ?? initialView(model));
    if (shouldOpenAutomatically(model)) setDialogOpen(true);
  }, [defaultView, model, setDialogOpen]);

  useLayoutEffect(() => {
    if (dialogContentRef.current) dialogContentRef.current.scrollTop = 0;
  }, [view]);

  const calendars = calendarsFromModel(model);
  const validDestination = useMemo(() => {
    const destination = findGoogleCalendarOption(calendars, destinationSelectionKey);
    return destination && canUseAsGoogleCalendarDestination(destination.accessRole)
      ? destination
      : null;
  }, [calendars, destinationSelectionKey]);
  const validBusySelectionKeys = useMemo(() => {
    const available = new Set(calendars.map((calendar) => calendar.selectionKey));
    return busySelectionKeys.filter((selectionKey) => available.has(selectionKey));
  }, [busySelectionKeys, calendars]);
  const selectionValid = validDestination !== null && validBusySelectionKeys.length > 0;
  const locallySelectedModel: GoogleCalendarUiModel =
    model.status === "connected" && validDestination && validBusySelectionKeys.length > 0
      ? {
          ...model,
          selection: {
            destinationSelectionKey: validDestination.selectionKey,
            busySelectionKeys: validBusySelectionKeys,
          },
        }
      : model;
  const visibleModel = hideDismissedSyncIssues(locallySelectedModel, dismissedIssueKeys);

  function handleDialogOpenChange(next: boolean) {
    if (pendingAction) return;
    if (next) setView(defaultView ?? initialView(model));
    setFeedback(null);
    setDialogOpen(next);
  }

  async function runAction(
    actionName: PendingAction,
    perform: () => Promise<GoogleCalendarActionResult>,
    onSuccess?: () => void,
  ): Promise<boolean> {
    if (pendingAction) return false;
    setPendingAction(actionName);
    setFeedback(null);
    try {
      const result = await perform();
      if (!result.ok) {
        setFeedback(actionFailureCopy(actionName, result.reason));
        return false;
      }
      onSuccess?.();
      return true;
    } catch {
      setFeedback(actionFailureCopy(actionName, "unavailable"));
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function connect() {
    await runAction("connect", actions.connect);
  }

  async function reconnect() {
    await runAction("reconnect", actions.reconnect);
  }

  async function refreshCalendars() {
    await runAction("refreshCalendars", actions.refreshCalendars, () => {
      toast("Calendar list refreshed.", "success");
    });
  }

  async function saveSelection() {
    if (!validDestination || validBusySelectionKeys.length === 0) {
      setFeedback("Choose one editable destination and at least one busy-time calendar.");
      return;
    }
    const selection: GoogleCalendarSelection = {
      destinationSelectionKey: validDestination.selectionKey,
      busySelectionKeys: validBusySelectionKeys,
    };
    await runAction(
      "saveSelection",
      () => actions.saveSelection(selection),
      () => {
        toast("Calendar choices saved.", "success");
        if (model.status === "connected") setView("summary");
        else setDialogOpen(false);
      },
    );
  }

  async function confirmAccountSwitch() {
    await runAction("confirmAccountSwitch", actions.confirmAccountSwitch, () => {
      setDialogOpen(false);
    });
  }

  async function disconnect() {
    await runAction("disconnect", actions.disconnect, () => {
      toast("Google Calendar disconnected.", "success");
      setDialogOpen(false);
    });
  }

  async function repairSync() {
    await runAction("repairSync", actions.repairSync);
  }

  async function clearSyncIssue(issue: GoogleCalendarSyncIssueIdentity) {
    const issueKey = syncIssueKey(issue);
    setClearingIssueKey(issueKey);
    const cleared = await runAction("clearSyncIssue", () => actions.clearSyncIssue(issue));
    if (cleared) {
      setDismissedIssueKeys((current) => [...new Set([...current, issueKey])]);
      toast("Sync warning cleared.", "success");
    }
    setClearingIssueKey(null);
  }

  const pendingMessage = pendingAction ? actionPendingCopy(pendingAction) : null;

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          disabled={visibleModel.status === "connecting"}
          aria-label={triggerAriaLabel(visibleModel)}
          aria-busy={visibleModel.status === "connecting" ? "true" : undefined}
          className="relative h-11 w-11 shrink-0 rounded-[var(--radius-lg)] lg:h-10 lg:w-auto lg:rounded-[var(--radius-md)] lg:px-3"
        >
          {visibleModel.status === "connecting" ? (
            <Loader2 className="motion-reduce:animate-none" size={17} aria-hidden />
          ) : (
            <CalendarSync size={17} aria-hidden />
          )}
          <span className="hidden lg:inline">{triggerVisibleLabel(visibleModel)}</span>
          <TriggerStatusDot model={visibleModel} />
        </Button>
      </DialogTrigger>

      <DialogContent
        ref={dialogContentRef}
        className={`max-h-[90dvh] gap-0 overflow-y-auto p-0 ${
          view === "destination_selection" || view === "busy_selection"
            ? "sm:max-w-[500px]"
            : "sm:max-w-[620px]"
        }`}
      >
        {view === "switch_confirmation" && canSwitchGoogleAccount(model) ? (
          <AccountSwitchConfirmation
            currentAccountLabel={model.accountLabel}
            previousAccount={model.status === "disconnected"}
            pendingAction={pendingAction}
            feedback={feedback}
            pendingMessage={pendingMessage}
            onCancel={() => {
              setFeedback(null);
              setView("summary");
            }}
            onConfirm={() => void confirmAccountSwitch()}
          />
        ) : view === "disconnect_confirmation" && hasConfiguredSelection(model) ? (
          <DisconnectConfirmation
            pendingAction={pendingAction}
            feedback={feedback}
            pendingMessage={pendingMessage}
            onKeepConnected={() => {
              setFeedback(null);
              setView("summary");
            }}
            onDisconnect={() => void disconnect()}
          />
        ) : (view === "destination_selection" || view === "busy_selection") &&
          model.status === "connected" ? (
          <CompactCalendarSelectionPanel
            kind={view === "destination_selection" ? "destination" : "busy"}
            model={model}
            destinationSelectionKey={destinationSelectionKey}
            busySelectionKeys={busySelectionKeys}
            pendingAction={pendingAction}
            feedback={feedback}
            pendingMessage={pendingMessage}
            onDestinationChange={setDestinationSelectionKey}
            onBusyChange={(selectionKey, selected) => {
              setBusySelectionKeys((current) => {
                if (selected) return [...new Set([...current, selectionKey])];
                return current.filter((value) => value !== selectionKey);
              });
            }}
            onCancel={() => {
              const selection = selectionFromModel(model);
              setDestinationSelectionKey(selection?.destinationSelectionKey ?? null);
              setBusySelectionKeys(selection?.busySelectionKeys ?? []);
              setFeedback(null);
              setView("summary");
            }}
            onSave={() => void saveSelection()}
          />
        ) : view === "selection" && hasCalendarSelection(model) ? (
          model.calendars.length === 0 ? (
            <EmptyCalendarSelectionPanel
              model={model}
              pendingAction={pendingAction}
              feedback={feedback}
              pendingMessage={pendingMessage}
              onFinishLater={() => {
                setFeedback(null);
                if (model.status === "connected") setView("summary");
                else setDialogOpen(false);
              }}
              onRefresh={() => void refreshCalendars()}
              onReconnect={() => void reconnect()}
            />
          ) : (
            <CalendarSelectionPanel
              model={model}
              destinationSelectionKey={destinationSelectionKey}
              busySelectionKeys={busySelectionKeys}
              selectionValid={selectionValid}
              pendingAction={pendingAction}
              feedback={feedback}
              pendingMessage={pendingMessage}
              onDestinationChange={setDestinationSelectionKey}
              onBusyChange={(selectionKey, selected) => {
                setBusySelectionKeys((current) => {
                  if (selected) return [...new Set([...current, selectionKey])];
                  return current.filter((value) => value !== selectionKey);
                });
              }}
              onCancel={() => {
                setFeedback(null);
                if (model.status === "connected") setView("summary");
                else setDialogOpen(false);
              }}
              onSave={() => void saveSelection()}
            />
          )
        ) : (
          <SummaryPanel
            model={visibleModel}
            pendingAction={pendingAction}
            feedback={feedback}
            pendingMessage={pendingMessage}
            timeZone={timeZone}
            onConnect={() => void connect()}
            onReconnect={() => void reconnect()}
            onEdit={() => {
              setFeedback(null);
              setView("selection");
            }}
            onEditDestination={() => {
              setFeedback(null);
              setView("destination_selection");
            }}
            onEditBusy={() => {
              setFeedback(null);
              setView("busy_selection");
            }}
            onSwitch={() => {
              setFeedback(null);
              setView("switch_confirmation");
            }}
            onDisconnect={() => {
              setFeedback(null);
              setView("disconnect_confirmation");
            }}
            onRepair={() => void repairSync()}
            onClearSyncIssue={(issue) => void clearSyncIssue(issue)}
            clearingIssueKey={clearingIssueKey}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryPanel({
  model,
  pendingAction,
  feedback,
  pendingMessage,
  timeZone,
  onConnect,
  onReconnect,
  onEdit,
  onEditDestination,
  onEditBusy,
  onSwitch,
  onDisconnect,
  onRepair,
  onClearSyncIssue,
  clearingIssueKey,
}: {
  model: GoogleCalendarUiModel;
  pendingAction: PendingAction | null;
  feedback: string | null;
  pendingMessage: string | null;
  timeZone: string;
  onConnect: () => void;
  onReconnect: () => void;
  onEdit: () => void;
  onEditDestination: () => void;
  onEditBusy: () => void;
  onSwitch: () => void;
  onDisconnect: () => void;
  onRepair: () => void;
  onClearSyncIssue: (issue: GoogleCalendarSyncIssueIdentity) => void;
  clearingIssueKey: string | null;
}) {
  if (model.status === "not_connected" || model.status === "connecting") {
    const connecting = model.status === "connecting" || pendingAction === "connect";
    return (
      <>
        <PanelHeader
          icon={connecting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
          eyebrow="Calendar connection"
          title={connecting ? "Connecting Google Calendar" : "Connect Google Calendar"}
          description="Avoid busy times and keep confirmed Skitza sessions on your calendar."
          badge={connecting ? { label: "Connecting", tone: "warning" } : undefined}
        />
        <div className="px-5 py-4 sm:px-6">
          <GoogleDataDisclosure />
        </div>
        <PanelFooter
          feedback={feedback}
          pendingMessage={connecting ? "Connecting…" : pendingMessage}
        >
          <Button
            type="button"
            size="lg"
            className="w-full rounded-[var(--radius-lg)] sm:w-auto"
            disabled={connecting}
            onClick={onConnect}
          >
            {connecting ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
            ) : (
              <CalendarSync size={16} aria-hidden />
            )}
            {connecting ? "Connecting…" : "Connect Google Calendar"}
          </Button>
        </PanelFooter>
      </>
    );
  }

  if (model.status === "disconnected") {
    return (
      <>
        <PanelHeader
          icon={<CircleAlert />}
          eyebrow="Calendar connection"
          title="Google Calendar is disconnected"
          description="Existing sessions and Google events stay as they are. Reconnect the previous account or choose a different one."
          badge={{ label: "Disconnected", tone: "warning" }}
        />
        <div className="space-y-3 px-5 py-4 sm:px-6">
          <AccountStrip label="Previous account" value={model.accountLabel} />
          <SyncHealthSummary summary={model.syncSummary} disconnected />
          <GoogleDataDisclosure />
        </div>
        <PanelFooter feedback={feedback} pendingMessage={pendingMessage}>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="rounded-[var(--radius-lg)]"
            disabled={pendingAction !== null}
            onClick={onSwitch}
          >
            Switch account
          </Button>
          <Button
            type="button"
            size="lg"
            className="rounded-[var(--radius-lg)]"
            disabled={pendingAction !== null}
            onClick={onConnect}
          >
            {pendingAction === "connect" ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
            ) : null}
            Reconnect previous account
          </Button>
        </PanelFooter>
      </>
    );
  }

  if (model.status === "reconnect_required") {
    return (
      <>
        <PanelHeader
          icon={<CircleAlert />}
          eyebrow="Calendar connection"
          title="Reconnect Google Calendar"
          description="Google needs permission again. Your Skitza sessions are safe."
          badge={{ label: "Reconnect needed", tone: "warning" }}
        />
        <div className="space-y-3 px-5 py-4 sm:px-6">
          <AccountStrip label="Connected account" value={model.accountLabel} />
          <SyncHealthSummary summary={model.syncSummary} disconnected />
          <GoogleDataDisclosure />
        </div>
        <PanelFooter feedback={feedback} pendingMessage={pendingMessage}>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="rounded-[var(--radius-lg)]"
            disabled={pendingAction !== null}
            onClick={onDisconnect}
          >
            Disconnect
          </Button>
          <Button
            type="button"
            size="lg"
            className="rounded-[var(--radius-lg)]"
            disabled={pendingAction !== null}
            onClick={onReconnect}
          >
            {pendingAction === "reconnect" ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
            ) : null}
            Reconnect Google Calendar
          </Button>
        </PanelFooter>
      </>
    );
  }

  if (model.status === "connected") {
    const destination = findGoogleCalendarOption(
      model.calendars,
      model.selection.destinationSelectionKey,
    );
    const busyCalendars = model.selection.busySelectionKeys
      .map((selectionKey) => findGoogleCalendarOption(model.calendars, selectionKey))
      .filter((calendar): calendar is GoogleCalendarOption => calendar !== null);
    return (
      <>
        <PanelHeader
          icon={<Check />}
          eyebrow="Calendar connection"
          title="Google Calendar"
          description="Skitza sessions and Google Calendar are connected."
          badge={{ label: "Connected", tone: "success" }}
        />
        <div className="space-y-5 px-5 py-4 sm:px-6">
          <AccountStrip label="Connected account" value={model.accountLabel} />
          <SyncHealthSummary
            summary={model.syncSummary}
            timeZone={timeZone}
            onRepair={onRepair}
            repairPending={pendingAction === "repairSync"}
            actionPending={pendingAction !== null}
            onClear={onClearSyncIssue}
            clearingIssueKey={clearingIssueKey}
          />
          <CalendarRoutingSummary
            destination={destination}
            busyCalendars={busyCalendars}
            disabled={pendingAction !== null}
            onEditDestination={onEditDestination}
            onEditBusy={onEditBusy}
          />
        </div>
        <PanelFooter feedback={feedback} pendingMessage={pendingMessage} mobileStatic>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-row-reverse sm:items-center">
            <Button
              type="button"
              variant="secondary"
              disabled={pendingAction !== null}
              onClick={onSwitch}
            >
              Switch account
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]"
              disabled={pendingAction !== null}
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
          </div>
        </PanelFooter>
      </>
    );
  }

  return (
    <CalendarSelectionIntro
      pendingAction={pendingAction}
      feedback={feedback}
      pendingMessage={pendingMessage}
      onContinue={onEdit}
    />
  );
}

function CalendarSelectionIntro({
  pendingAction,
  feedback,
  pendingMessage,
  onContinue,
}: {
  pendingAction: PendingAction | null;
  feedback: string | null;
  pendingMessage: string | null;
  onContinue: () => void;
}) {
  return (
    <>
      <PanelHeader
        eyebrow="Calendar connection"
        title="Finish Google Calendar setup"
        description="Choose where Skitza events go and which calendars block booking times."
        badge={{ label: "Setup needed", tone: "warning" }}
      />
      <PanelFooter feedback={feedback} pendingMessage={pendingMessage}>
        <Button
          type="button"
          size="lg"
          className="w-full rounded-[var(--radius-lg)] sm:w-auto"
          disabled={pendingAction !== null}
          onClick={onContinue}
        >
          Choose calendars
        </Button>
      </PanelFooter>
    </>
  );
}

function EmptyCalendarSelectionPanel({
  model,
  pendingAction,
  feedback,
  pendingMessage,
  onFinishLater,
  onRefresh,
  onReconnect,
}: {
  model: Extract<GoogleCalendarUiModel, { status: "selection_required" | "connected" }>;
  pendingAction: PendingAction | null;
  feedback: string | null;
  pendingMessage: string | null;
  onFinishLater: () => void;
  onRefresh: () => void;
  onReconnect: () => void;
}) {
  const pending = pendingAction !== null;
  return (
    <>
      <PanelHeader
        icon={<CircleAlert />}
        eyebrow="Google Calendar"
        title="Calendars could not load"
        description="Your Google connection is saved, but the calendar list is not available yet."
        badge={{ label: "Try again", tone: "warning" }}
      />
      <div className="space-y-3 px-5 py-4 sm:px-6">
        <AccountStrip label="Google account" value={model.accountLabel} />
        <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-3.5">
          <p className="text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
            Load your calendars again
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Try again first. If Google asks for permission, reconnect instead. Your Skitza sessions
            are safe.
          </p>
        </div>
        <GoogleDataDisclosure />
      </div>
      <PanelFooter feedback={feedback} pendingMessage={pendingMessage}>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onFinishLater}
        >
          {model.status === "connected" ? "Cancel" : "Finish later"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onReconnect}
        >
          {pendingAction === "reconnect" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
          ) : null}
          Reconnect Google
        </Button>
        <Button
          type="button"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onRefresh}
        >
          {pendingAction === "refreshCalendars" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
          ) : null}
          Try loading again
        </Button>
      </PanelFooter>
    </>
  );
}

function CalendarSelectionPanel({
  model,
  destinationSelectionKey,
  busySelectionKeys,
  selectionValid,
  pendingAction,
  feedback,
  pendingMessage,
  onDestinationChange,
  onBusyChange,
  onCancel,
  onSave,
}: {
  model: Extract<GoogleCalendarUiModel, { status: "selection_required" | "connected" }>;
  destinationSelectionKey: string | null;
  busySelectionKeys: readonly string[];
  selectionValid: boolean;
  pendingAction: PendingAction | null;
  feedback: string | null;
  pendingMessage: string | null;
  onDestinationChange: (selectionKey: string) => void;
  onBusyChange: (selectionKey: string, selected: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const pending = pendingAction !== null;
  return (
    <>
      <PanelHeader
        eyebrow="Google Calendar"
        title="Choose calendars"
        description="Set one destination for Skitza events and the calendars that block booking times."
        badge={
          model.status === "selection_required"
            ? { label: "Setup needed", tone: "warning" }
            : undefined
        }
      />
      <div className="space-y-5 px-5 py-4 sm:px-6">
        <AccountStrip label="Google account" value={model.accountLabel} />

        <fieldset
          disabled={pending}
          className="border-l-2 border-[rgb(var(--brand-primary)/0.45)] pl-3"
        >
          <legend className="font-display text-[15px] font-bold tracking-tight text-[rgb(var(--fg-default))]">
            Events go to
          </legend>
          <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Choose one calendar Skitza can edit.
          </p>
          <div className="mt-3 space-y-2">
            {model.calendars.map((calendar) => (
              <CalendarOptionRow
                key={calendar.selectionKey}
                calendar={calendar}
                kind="destination"
                checked={destinationSelectionKey === calendar.selectionKey}
                disabled={!canUseAsGoogleCalendarDestination(calendar.accessRole)}
                onChange={(checked) => {
                  if (checked) onDestinationChange(calendar.selectionKey);
                }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset
          disabled={pending}
          className="border-l-2 border-[rgb(var(--fg-default)/0.16)] pl-3"
        >
          <legend className="font-display text-[15px] font-bold tracking-tight text-[rgb(var(--fg-default))]">
            Busy time comes from
          </legend>
          <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Choose one or more calendars. Skitza only checks busy and free time.
          </p>
          <div className="mt-3 space-y-2">
            {model.calendars.map((calendar) => (
              <CalendarOptionRow
                key={calendar.selectionKey}
                calendar={calendar}
                kind="busy"
                checked={busySelectionKeys.includes(calendar.selectionKey)}
                disabled={false}
                onChange={(checked) => {
                  onBusyChange(calendar.selectionKey, checked);
                }}
              />
            ))}
          </div>
        </fieldset>

        <p className="text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {!selectionValid
            ? "Choose one editable destination and at least one busy-time calendar."
            : "Ready to save these calendar choices."}
        </p>
      </div>
      <PanelFooter feedback={feedback} pendingMessage={pendingMessage}>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onCancel}
        >
          {model.status === "connected" ? "Cancel" : "Finish later"}
        </Button>
        <Button
          type="button"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending || !selectionValid}
          onClick={onSave}
        >
          {pendingAction === "saveSelection" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
          ) : null}
          Save calendars
        </Button>
      </PanelFooter>
    </>
  );
}

function CompactCalendarSelectionPanel({
  kind,
  model,
  destinationSelectionKey,
  busySelectionKeys,
  pendingAction,
  feedback,
  pendingMessage,
  onDestinationChange,
  onBusyChange,
  onCancel,
  onSave,
}: {
  kind: "destination" | "busy";
  model: Extract<GoogleCalendarUiModel, { status: "connected" }>;
  destinationSelectionKey: string | null;
  busySelectionKeys: readonly string[];
  pendingAction: PendingAction | null;
  feedback: string | null;
  pendingMessage: string | null;
  onDestinationChange: (selectionKey: string) => void;
  onBusyChange: (selectionKey: string, selected: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const destination = findGoogleCalendarOption(model.calendars, destinationSelectionKey);
  const destinationValid = Boolean(
    destination && canUseAsGoogleCalendarDestination(destination.accessRole),
  );
  const busySelectionValid = busySelectionKeys.some((selectionKey) =>
    model.calendars.some((calendar) => calendar.selectionKey === selectionKey),
  );
  const selectionValid = kind === "destination" ? destinationValid : busySelectionValid;
  const pending = pendingAction !== null;
  const title = kind === "destination" ? "Events go to" : "Busy time comes from";
  const description =
    kind === "destination"
      ? "Choose the one calendar where Skitza creates and updates sessions."
      : "Choose the calendars that block unavailable booking times.";

  return (
    <>
      <PanelHeader eyebrow="Calendar setup" title={title} description={description} />
      <fieldset disabled={pending} className="px-5 py-4 sm:px-6">
        <legend className="sr-only">{title}</legend>
        <div className="max-h-[min(48dvh,360px)] space-y-2 overflow-y-auto pr-1">
          {model.calendars.map((calendar) => (
            <CalendarOptionRow
              key={calendar.selectionKey}
              calendar={calendar}
              kind={kind}
              checked={
                kind === "destination"
                  ? destinationSelectionKey === calendar.selectionKey
                  : busySelectionKeys.includes(calendar.selectionKey)
              }
              compact
              disabled={
                kind === "destination"
                  ? !canUseAsGoogleCalendarDestination(calendar.accessRole)
                  : false
              }
              onChange={(checked) => {
                if (kind === "destination") {
                  if (checked) onDestinationChange(calendar.selectionKey);
                  return;
                }
                onBusyChange(calendar.selectionKey, checked);
              }}
            />
          ))}
        </div>
        {!selectionValid ? (
          <p className="mt-3 text-[11.5px] text-[rgb(var(--fg-warning-text))]">
            {kind === "destination"
              ? "Choose a calendar Skitza can edit."
              : "Choose at least one busy-time calendar."}
          </p>
        ) : null}
      </fieldset>
      <PanelFooter feedback={feedback} pendingMessage={pendingMessage} mobileStatic>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={pending || !selectionValid} onClick={onSave}>
          {pendingAction === "saveSelection" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
          ) : null}
          {kind === "destination" ? "Save destination" : "Save busy calendars"}
        </Button>
      </PanelFooter>
    </>
  );
}

function CalendarOptionRow({
  calendar,
  kind,
  checked,
  compact = false,
  disabled,
  onChange,
}: {
  calendar: GoogleCalendarOption;
  kind: "destination" | "busy";
  checked: boolean;
  compact?: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const roleLabel = googleCalendarAccessRoleLabel(calendar.accessRole);
  return (
    <label
      className={[
        "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border px-3 transition-colors motion-reduce:transition-none",
        compact ? "min-h-12 py-2" : "min-h-14 py-2.5",
        checked
          ? "border-[rgb(var(--brand-primary)/0.55)] bg-[rgb(var(--brand-primary)/0.07)]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))]",
        disabled ? "cursor-not-allowed opacity-65" : "",
      ].join(" ")}
    >
      <input
        type={kind === "destination" ? "radio" : "checkbox"}
        name={kind === "destination" ? "google-calendar-destination" : undefined}
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-1 h-4 w-4 accent-[rgb(var(--brand-primary))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--focus-ring))]"
      />
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-bold break-words text-[rgb(var(--fg-default))]">
            {calendar.name}
          </span>
          {calendar.primary ? (
            <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-secondary))] uppercase">
              Primary
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
          <span>{calendar.timeZone}</span>
          <span aria-hidden>·</span>
          <span>{roleLabel}</span>
        </span>
        {kind === "destination" && disabled ? (
          <span className="mt-1 block text-[11px] text-[rgb(var(--fg-warning-text))]">
            This access role cannot receive Skitza events.
          </span>
        ) : null}
      </span>
    </label>
  );
}

function AccountSwitchConfirmation({
  currentAccountLabel,
  previousAccount,
  pendingAction,
  feedback,
  pendingMessage,
  onCancel,
  onConfirm,
}: {
  currentAccountLabel: string;
  previousAccount: boolean;
  pendingAction: PendingAction | null;
  feedback: string | null;
  pendingMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const pending = pendingAction !== null;
  return (
    <>
      <PanelHeader
        icon={<CircleAlert />}
        eyebrow="Google account"
        title="Switch Google account?"
        description="Existing events stay in the old account. Old event links will not be reused."
        badge={{ label: "Confirm switch", tone: "warning" }}
      />
      <div className="space-y-4 px-5 py-4 sm:px-6">
        <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <AccountCard
            label={previousAccount ? "Previous" : "Current"}
            value={currentAccountLabel}
          />
          <ArrowRight
            className="mx-auto rotate-90 text-[rgb(var(--fg-muted))] sm:rotate-0"
            size={18}
            aria-hidden
          />
          <div className="min-w-0 rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-overlay))] p-3">
            <span className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              New
            </span>
            <p className="mt-1 text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
              Choose in Google
            </p>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          New sessions will use the new account after you choose its calendars.
        </p>
        <GoogleDataDisclosure />
      </div>
      <PanelFooter feedback={feedback} pendingMessage={pendingMessage}>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onCancel}
        >
          Keep current account
        </Button>
        <Button
          type="button"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onConfirm}
        >
          {pendingAction === "confirmAccountSwitch" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
          ) : null}
          Switch and choose calendars
        </Button>
      </PanelFooter>
    </>
  );
}

function DisconnectConfirmation({
  pendingAction,
  feedback,
  pendingMessage,
  onKeepConnected,
  onDisconnect,
}: {
  pendingAction: PendingAction | null;
  feedback: string | null;
  pendingMessage: string | null;
  onKeepConnected: () => void;
  onDisconnect: () => void;
}) {
  const pending = pendingAction !== null;
  return (
    <>
      <PanelHeader
        icon={<CircleAlert />}
        eyebrow="Calendar connection"
        title="Disconnect Google Calendar?"
        description="Skitza sessions and existing Google events stay. New changes stop syncing."
        badge={{ label: "Disconnect", tone: "danger" }}
      />
      <div className="space-y-3 px-5 py-4 sm:px-6">
        <p className="text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Disconnecting stops future Google access and sync. Skitza removes its saved Google access
          tokens and calendar choices and asks Google to revoke the permission. Your Skitza sessions
          and existing Google events stay.
        </p>
        <p className="text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Skitza keeps the connected account email and technical event and sync records so a
          reconnect does not create duplicate events. Delete existing events directly in Google
          Calendar. To request deletion of retained Google connection data, email{" "}
          <a
            className="font-semibold underline underline-offset-2"
            href="mailto:privacy@skitza.app"
          >
            privacy@skitza.app
          </a>
          . You can also remove Skitza from your{" "}
          <a
            className="font-semibold underline underline-offset-2"
            href="https://myaccount.google.com/connections"
            target="_blank"
            rel="noreferrer"
          >
            Google Account&apos;s third-party connections
          </a>
          .
        </p>
      </div>
      <PanelFooter feedback={feedback} pendingMessage={pendingMessage}>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onKeepConnected}
        >
          Keep connected
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="lg"
          className="rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={onDisconnect}
        >
          {pendingAction === "disconnect" ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden />
          ) : null}
          Disconnect
        </Button>
      </PanelFooter>
    </>
  );
}

function PanelHeader({
  icon,
  eyebrow,
  title,
  description,
  badge,
}: {
  icon?: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  badge?: { label: string; tone: "success" | "warning" | "danger" } | undefined;
}) {
  return (
    <DialogHeader className="border-b border-[rgb(var(--border-subtle))] px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
      <div className="flex items-start gap-3 pr-9">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-text))] sm:inline-flex [&>svg]:h-[18px] [&>svg]:w-[18px]">
          {icon ?? <CalendarSync aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[9.5px] font-bold tracking-[0.15em] text-[rgb(var(--brand-primary-text))] uppercase">
            {eyebrow}
          </span>
          <span className="mt-1 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <DialogTitle className="text-[18px] font-extrabold tracking-[-0.025em] sm:text-[20px]">
              {title}
            </DialogTitle>
            {badge ? <StatusBadge {...badge} /> : null}
          </span>
          <DialogDescription className="mt-1.5 max-w-[470px] text-[12.5px] leading-relaxed">
            {description}
          </DialogDescription>
        </span>
      </div>
    </DialogHeader>
  );
}

function PanelFooter({
  feedback,
  pendingMessage,
  children,
  mobileStatic = false,
}: {
  feedback: string | null;
  pendingMessage: string | null;
  children: React.ReactNode;
  mobileStatic?: boolean;
}) {
  const status = feedback ?? pendingMessage;
  return (
    <div
      className={[
        "border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.96)] px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-xl sm:sticky sm:bottom-0 sm:px-6 sm:pb-5",
        mobileStatic ? "" : "sticky bottom-0",
      ].join(" ")}
    >
      {status ? (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={[
            "mb-2 text-[11.5px] leading-relaxed",
            feedback ? "text-[rgb(var(--fg-danger-text))]" : "text-[rgb(var(--fg-muted))]",
          ].join(" ")}
        >
          {status}
        </p>
      ) : null}
      <DialogFooter>{children}</DialogFooter>
    </div>
  );
}

function GoogleDataDisclosure() {
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-3.5">
      <ShieldCheck
        className="mt-0.5 shrink-0 text-[rgb(var(--brand-primary-text))]"
        size={17}
        aria-hidden
      />
      <div className="min-w-0 text-[12px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        <p className="font-bold text-[rgb(var(--fg-default))]">How Skitza uses your Google data</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4">
          <li>
            Skitza reads your Google account email and calendar names, timezones, and access levels
            so you can choose calendars.
          </li>
          <li>
            On calendars you choose for availability, Skitza checks only busy and free times. It
            does not read unrelated event titles or details.
          </li>
          <li>
            Google&apos;s event permission covers the calendars you can access. Skitza uses it to
            create, update, read, delete, watch, and reconcile Skitza session events in the
            destination calendar you choose. These events can include the session title and time,
            Producer and Artist names and email addresses, RSVP status, and a Skitza link. When
            updating one of these events, Skitza may temporarily read and preserve other attendees
            already on it but does not save them in its database.
          </li>
          <li>
            Skitza stores encrypted Google tokens, your account identity, calendar choices, and
            technical sync records only to run this feature. It does not sell Google data, use it
            for advertising, or share it except with service providers that operate Skitza as
            explained in the Privacy Notice.
          </li>
        </ul>
        <p className="mt-2">
          Select the Google action below to continue to Google and choose whether to grant these
          permissions. You can disconnect at any time. Read the{" "}
          <a className="font-semibold underline underline-offset-2" href="/privacy">
            Privacy Notice
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function AccountStrip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-[rgb(var(--border-subtle))] pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">{label}</span>
      <span className="min-w-0 text-[13px] font-bold break-all text-[rgb(var(--fg-default))]">
        {value}
      </span>
    </div>
  );
}

function AccountCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-3">
      <span className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </span>
      <p className="mt-1 text-[12.5px] font-bold break-all text-[rgb(var(--fg-default))]">
        {value}
      </p>
    </div>
  );
}

function CalendarRoutingSummary({
  destination,
  busyCalendars,
  disabled,
  onEditDestination,
  onEditBusy,
}: {
  destination: GoogleCalendarOption | null;
  busyCalendars: readonly GoogleCalendarOption[];
  disabled: boolean;
  onEditDestination: () => void;
  onEditBusy: () => void;
}) {
  return (
    <section aria-label="Calendar setup">
      <h3 className="font-display text-[14px] font-bold tracking-tight text-[rgb(var(--fg-default))]">
        Calendar setup
      </h3>
      <dl className="mt-2 divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]">
        <CalendarRouteRow
          label="Events go to"
          calendars={destination ? [destination] : []}
          emptyCopy="Choose a destination calendar"
          disabled={disabled}
          onEdit={onEditDestination}
        />
        <CalendarRouteRow
          label="Busy time comes from"
          calendars={busyCalendars}
          emptyCopy="Choose a busy-time calendar"
          disabled={disabled}
          onEdit={onEditBusy}
        />
      </dl>
    </section>
  );
}

function CalendarRouteRow({
  label,
  calendars,
  emptyCopy,
  disabled,
  onEdit,
}: {
  label: string;
  calendars: readonly GoogleCalendarOption[];
  emptyCopy: string;
  disabled: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-1 px-3.5 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="text-[11.5px] font-medium text-[rgb(var(--fg-muted))]">{label}</dt>
      <dd className="flex min-w-0 items-center justify-between gap-2 text-[12.5px] font-bold text-[rgb(var(--fg-default))] sm:justify-end">
        <span className="min-w-0 break-words sm:text-right">
          {calendars.length > 0 ? (
            calendars.map((calendar) => calendar.name).join(", ")
          ) : (
            <span className="font-medium text-[rgb(var(--fg-warning-text))]">{emptyCopy}</span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
          aria-label={`Edit ${label}`}
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil size={14} strokeWidth={2.2} aria-hidden />
        </Button>
      </dd>
    </div>
  );
}

function SyncHealthSummary({
  summary,
  disconnected = false,
  timeZone = "UTC",
  onRepair,
  repairPending = false,
  actionPending = false,
  onClear,
  clearingIssueKey,
}: {
  summary: GoogleCalendarSyncSummary;
  disconnected?: boolean;
  timeZone?: string;
  onRepair?: () => void;
  repairPending?: boolean;
  actionPending?: boolean;
  onClear?: (issue: GoogleCalendarSyncIssueIdentity) => void;
  clearingIssueKey?: string | null;
}) {
  const attention = summary.notSynced + summary.missing + summary.conflicts;
  const title = disconnected
    ? "Sync is paused"
    : attention > 0
      ? `${String(attention)} ${attention === 1 ? "session needs" : "sessions need"} attention`
      : summary.syncing > 0
        ? `${String(summary.syncing)} ${summary.syncing === 1 ? "session is" : "sessions are"} syncing`
        : "Calendar sync is up to date";
  const description = disconnected
    ? "Reconnect Google to continue syncing. Your Skitza sessions are safe."
    : attention > 0
      ? "Skitza keeps trying automatically. Your session times are safe."
      : summary.syncing > 0
        ? "Skitza is sending the latest session changes to Google."
        : "All linked sessions match Google Calendar.";
  const statusIcon = disconnected || attention > 0 ? <CircleAlert /> : <Check />;

  return (
    <section
      aria-label="Google Calendar sync status"
      className={[
        "overflow-hidden rounded-[var(--radius-lg)] border",
        disconnected || attention > 0
          ? "border-[rgb(var(--fg-warning)/0.3)] bg-[rgb(var(--fg-warning)/0.06)]"
          : "border-[rgb(var(--fg-success)/0.25)] bg-[rgb(var(--fg-success)/0.06)]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 px-3.5 py-3.5">
        <span
          className={[
            "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full [&>svg]:h-[15px] [&>svg]:w-[15px]",
            disconnected || attention > 0
              ? "bg-[rgb(var(--fg-warning)/0.14)] text-[rgb(var(--fg-warning-text))]"
              : "bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]",
          ].join(" ")}
          aria-hidden
        >
          {statusIcon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-[13px] font-bold text-[rgb(var(--fg-default))]">{title}</p>
            {summary.syncing > 0 ? (
              <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-elevated)/0.75)] px-2 py-1 text-[10px] font-semibold text-[rgb(var(--fg-muted))]">
                {summary.syncing} syncing
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {description}
          </p>
        </div>
      </div>
      {summary.issues.length > 0 ? (
        <ul className="divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.78)]">
          {summary.issues.map((issue) => (
            <li
              key={syncIssueKey(issue)}
              className="grid gap-1.5 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(170px,0.8fr)] sm:gap-5"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-[rgb(var(--fg-default))]">
                  {issue.artistName}
                </p>
                <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))]">
                  {formatSyncIssueTime(issue.startsAtIso, issue.durationMin, timeZone)}
                </p>
              </div>
              <div className="min-w-0 sm:text-right">
                <p className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-warning-text))]">
                  {syncIssueCopy(issue)}
                </p>
                {!disconnected && onClear ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 rounded-[var(--radius-sm)] px-2 text-[11px] text-[rgb(var(--fg-secondary))]"
                    aria-label={`Clear warning for ${issue.artistName}`}
                    disabled={actionPending}
                    onClick={() => {
                      onClear({
                        bookingId: issue.bookingId,
                        syncState: issue.syncState,
                        stateChangedAtIso: issue.stateChangedAtIso,
                      });
                    }}
                  >
                    {clearingIssueKey === syncIssueKey(issue) ? (
                      <Loader2
                        className="animate-spin motion-reduce:animate-none"
                        size={13}
                        aria-hidden
                      />
                    ) : null}
                    {clearingIssueKey === syncIssueKey(issue) ? "Clearing…" : "Clear"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {!disconnected && attention > 0 && onRepair ? (
        <div className="flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-[rgb(var(--fg-muted))]">You can also retry now.</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-[var(--radius-sm)]"
            disabled={actionPending}
            onClick={onRepair}
          >
            {repairPending ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" size={14} aria-hidden />
            ) : null}
            {repairPending ? "Trying sync again…" : "Try sync again"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function formatSyncIssueTime(startsAtIso: string, durationMin: number, timeZone: string): string {
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
  const format = (zone: string) => {
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${day.format(startsAt)} · ${time.format(startsAt)}–${time.format(endsAt)}`;
  };
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

function syncIssueCopy(issue: GoogleCalendarSyncSummary["issues"][number]): string {
  if (issue.bookingStatus === "cancelled") return "Cancelled session cleanup is waiting.";
  if (issue.syncState === "missing") return "Google event is missing.";
  if (issue.syncState === "conflict") {
    return "Google change could not be used. Skitza time was kept.";
  }
  return "Could not sync this session to Google.";
}

function syncIssueKey(issue: GoogleCalendarSyncIssueIdentity): string {
  return `${issue.bookingId}:${issue.syncState}:${issue.stateChangedAtIso}`;
}

function hideDismissedSyncIssues(
  model: GoogleCalendarUiModel,
  dismissedIssueKeys: readonly string[],
): GoogleCalendarUiModel {
  if (model.status !== "connected" || dismissedIssueKeys.length === 0) return model;
  const dismissed = new Set(dismissedIssueKeys);
  const removed = model.syncSummary.issues.filter((issue) => dismissed.has(syncIssueKey(issue)));
  if (removed.length === 0) return model;

  let notSynced = model.syncSummary.notSynced;
  let missing = model.syncSummary.missing;
  let conflicts = model.syncSummary.conflicts;
  for (const issue of removed) {
    if (issue.syncState === "not_synced") notSynced = Math.max(0, notSynced - 1);
    else if (issue.syncState === "missing") missing = Math.max(0, missing - 1);
    else conflicts = Math.max(0, conflicts - 1);
  }

  return {
    ...model,
    syncSummary: {
      ...model.syncSummary,
      notSynced,
      missing,
      conflicts,
      issues: model.syncSummary.issues.filter((issue) => !dismissed.has(syncIssueKey(issue))),
    },
  };
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" }) {
  const toneClass =
    tone === "success"
      ? "border-[rgb(var(--fg-success)/0.25)] bg-[rgb(var(--fg-success)/0.1)] text-[rgb(var(--fg-success-text))]"
      : tone === "danger"
        ? "border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger-text))]"
        : "border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.1)] text-[rgb(var(--fg-warning-text))]";
  return (
    <span
      className={`inline-flex rounded-[var(--radius-sm)] border px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.09em] uppercase ${toneClass}`}
    >
      {label}
    </span>
  );
}

function TriggerStatusDot({ model }: { model: GoogleCalendarUiModel }) {
  if (model.status === "not_connected" || model.status === "connecting") return null;
  const hasAttention =
    model.syncSummary.notSynced + model.syncSummary.missing + model.syncSummary.conflicts > 0;
  const dotClass =
    model.status === "connected" && !hasAttention
      ? "bg-[rgb(var(--fg-success))]"
      : "bg-[rgb(var(--brand-primary))]";
  return (
    <span
      aria-hidden
      className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-[rgb(var(--bg-elevated))] ${dotClass}`}
    />
  );
}

function hasCalendarSelection(
  model: GoogleCalendarUiModel,
): model is Extract<GoogleCalendarUiModel, { status: "selection_required" | "connected" }> {
  return model.status === "selection_required" || model.status === "connected";
}

function canSwitchGoogleAccount(
  model: GoogleCalendarUiModel,
): model is Extract<GoogleCalendarUiModel, { status: "connected" | "disconnected" }> {
  return model.status === "connected" || model.status === "disconnected";
}

function hasConfiguredSelection(
  model: GoogleCalendarUiModel,
): model is Extract<GoogleCalendarUiModel, { status: "connected" | "reconnect_required" }> {
  return model.status === "connected" || model.status === "reconnect_required";
}

function calendarsFromModel(model: GoogleCalendarUiModel): readonly GoogleCalendarOption[] {
  if (model.status === "selection_required" || model.status === "connected") {
    return model.calendars;
  }
  return model.status === "reconnect_required" ? (model.calendars ?? []) : [];
}

function selectionFromModel(model: GoogleCalendarUiModel): GoogleCalendarSelection | null {
  if (model.status === "selection_required" || model.status === "connected") {
    return model.selection;
  }
  return model.status === "reconnect_required" ? (model.selection ?? null) : null;
}

function shouldOpenAutomatically(model: GoogleCalendarUiModel): boolean {
  return model.status === "selection_required";
}

function initialView(model: GoogleCalendarUiModel): GoogleCalendarControlView {
  if (model.status === "selection_required") return "selection";
  return "summary";
}

function triggerAriaLabel(model: GoogleCalendarUiModel): string {
  switch (model.status) {
    case "not_connected":
      return "Connect Google Calendar";
    case "connecting":
      return "Connecting Google Calendar";
    case "disconnected":
      return "Manage disconnected Google Calendar";
    case "selection_required":
      return "Finish Google Calendar setup";
    case "connected":
      return connectedTriggerCopy(model, "Manage Google Calendar");
    case "reconnect_required":
      return "Reconnect Google Calendar";
  }
}

function triggerVisibleLabel(model: GoogleCalendarUiModel): string {
  switch (model.status) {
    case "not_connected":
      return "Connect Google";
    case "connecting":
      return "Connecting…";
    case "disconnected":
      return "Google disconnected";
    case "selection_required":
      return "Finish setup";
    case "connected":
      return connectedTriggerCopy(model, "Google synced");
    case "reconnect_required":
      return "Reconnect Google";
  }
}

function connectedTriggerCopy(
  model: Extract<GoogleCalendarUiModel, { status: "connected" }>,
  healthyCopy: string,
): string {
  const attention =
    model.syncSummary.notSynced + model.syncSummary.missing + model.syncSummary.conflicts;
  if (attention > 0) return `${String(attention)} sync ${attention === 1 ? "issue" : "issues"}`;
  if (model.syncSummary.syncing > 0) return `${String(model.syncSummary.syncing)} syncing`;
  return healthyCopy;
}

function actionPendingCopy(action: PendingAction): string {
  switch (action) {
    case "connect":
      return "Opening Google…";
    case "refreshCalendars":
      return "Loading calendars…";
    case "saveSelection":
      return "Saving calendar choices…";
    case "reconnect":
      return "Opening Google to reconnect…";
    case "confirmAccountSwitch":
      return "Opening Google to choose an account…";
    case "disconnect":
      return "Disconnecting Google Calendar…";
    case "repairSync":
      return "Trying calendar sync again…";
    case "clearSyncIssue":
      return "Clearing sync warning…";
  }
}

function actionFailureCopy(
  action: PendingAction,
  reason: GoogleCalendarActionFailureReason,
): string {
  if (reason === "offline") return "Reconnect to the internet and try again.";
  if (reason === "permission_required") {
    return "Google Calendar permission is required. Reconnect and try again.";
  }
  if (reason === "invalid_selection") {
    return "Choose one editable destination and at least one busy-time calendar.";
  }
  switch (action) {
    case "connect":
      return "Could not connect Google Calendar. Try again.";
    case "refreshCalendars":
      return "Could not load calendars. Try again.";
    case "saveSelection":
      return "Could not save these calendar choices. Try again.";
    case "reconnect":
      return "Could not reconnect Google Calendar. Try again.";
    case "confirmAccountSwitch":
      return "Could not update the Google account. Try again.";
    case "disconnect":
      return "Could not disconnect Google Calendar. Try again.";
    case "repairSync":
      return "Could not retry calendar sync. Try again.";
    case "clearSyncIssue":
      return "Could not clear the sync warning. Try again.";
  }
}
