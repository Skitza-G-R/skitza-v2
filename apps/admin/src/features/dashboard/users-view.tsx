"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  DemoAccountStatus,
  DemoSupportNote,
  DemoUserDirectory,
  DemoUserProfile,
  DemoUserSummary,
} from "~/lib/admin-demo-view-models";
import { useFloatingMenuPosition } from "./dashboard-interactions";
import styles from "./dashboard.module.css";
import { Badge, EmptyState, PageHeader, Panel } from "./shared";
import interactionStyles from "./user-interactions.module.css";
import {
  appendSupportNote,
  filterAndSortUsers,
  hasValidationErrors,
  normalizeSupportTags,
  paginateUsers,
  PROFILE_TABS,
  type ProfileTab,
  type SortDirection,
  type UserRoleFilter,
  type UserSortKey,
  type UserStatusFilter,
  updateUserStatus,
  validateRequiredReason,
  validateSupportDetails,
  validateSupportNote,
  validateWorkspaceDeletion,
} from "./user-demo-workflows";

function accountTone(status: DemoAccountStatus): "danger" | "success" | "warning" {
  if (status === "Active") return "success";
  if (status === "Suspended") return "danger";
  return "warning";
}

function DemoToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(onDismiss, 4_500);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className={interactionStyles.toast} role="status">
      <span>{message}</span>
      <button aria-label="Dismiss notification" onClick={onDismiss} type="button">
        ×
      </button>
    </div>
  );
}

function Modal({
  children,
  description,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  onClose: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={interactionStyles.modalDialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <section className={interactionStyles.modal}>
        <header className={interactionStyles.modalHeader}>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button
            aria-label="Close dialog"
            className={interactionStyles.closeButton}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </dialog>
  );
}

function SortButton({
  activeDirection,
  children,
  onSort,
}: {
  activeDirection: SortDirection | null;
  children: ReactNode;
  onSort: () => void;
}) {
  return (
    <button className={interactionStyles.sortButton} onClick={onSort} type="button">
      {children}
      <span aria-hidden="true">
        {activeDirection === null ? "↕" : activeDirection === "asc" ? "↑" : "↓"}
      </span>
    </button>
  );
}

function RowActions({
  base,
  isOpen,
  onClose,
  onCopy,
  onToggleMenu,
  onToggleStatus,
  openUp = false,
  user,
}: {
  base: string;
  isOpen: boolean;
  onClose: () => void;
  onCopy: () => void;
  onToggleMenu: () => void;
  onToggleStatus: () => void;
  openUp?: boolean;
  user: DemoUserSummary;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const menuStyle = useFloatingMenuPosition({
    menuRef,
    open: isOpen,
    placement: openUp ? "up" : "down",
    triggerRef,
  });

  return (
    <div className={interactionStyles.rowActions}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-label={`Actions for ${user.name}`}
        className={interactionStyles.moreButton}
        onClick={onToggleMenu}
        ref={triggerRef}
        type="button"
      >
        ⋯
      </button>
      {isOpen ? (
        <div
          aria-label={`Actions for ${user.name}`}
          className={interactionStyles.actionMenu}
          id={menuId}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
            triggerRef.current?.focus();
          }}
          ref={menuRef}
          role="group"
          style={menuStyle}
        >
          <Link href={`${base}/${user.id}`} onClick={onClose}>
            Open profile
          </Link>
          <button
            onClick={() => {
              onCopy();
              onClose();
            }}
            type="button"
          >
            Copy user ID
          </button>
          <button
            onClick={() => {
              onToggleStatus();
              onClose();
            }}
            type="button"
          >
            {user.status === "Suspended" ? "Reactivate account" : "Suspend account"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function UsersDirectoryView({
  data,
  query: initialQuery = "",
  role: initialRole = "all",
}: {
  data: DemoUserDirectory;
  query?: string;
  role?: UserRoleFilter;
}) {
  const base = `/${data.environment}/users`;
  const [users, setUsers] = useState<DemoUserSummary[]>(() => [...data.users]);
  const [query, setQuery] = useState(initialQuery);
  const [role, setRole] = useState<UserRoleFilter>(initialRole);
  const [status, setStatus] = useState<UserStatusFilter>("all");
  const [sortKey, setSortKey] = useState<UserSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingStatusUser, setPendingStatusUser] = useState<DemoUserSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filteredUsers = useMemo(
    () =>
      filterAndSortUsers(users, {
        query,
        role,
        status,
        sortDirection,
        sortKey,
      }),
    [query, role, sortDirection, sortKey, status, users],
  );
  const pagination = paginateUsers(filteredUsers, page);
  const firstResult = filteredUsers.length === 0 ? 0 : (pagination.currentPage - 1) * 2 + 1;
  const lastResult = Math.min(pagination.currentPage * 2, filteredUsers.length);
  const hasFilters = query.trim().length > 0 || role !== "all" || status !== "all";

  useEffect(() => {
    if (page !== pagination.currentPage) setPage(pagination.currentPage);
  }, [page, pagination.currentPage]);

  function updateFilter(update: () => void) {
    update();
    setPage(1);
    setOpenMenuId(null);
  }

  function changeSort(nextKey: UserSortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
    setPage(1);
  }

  function confirmStatusChange(user: DemoUserSummary) {
    const nextStatus: DemoAccountStatus = user.status === "Suspended" ? "Active" : "Suspended";
    setUsers((current) =>
      current.map((entry) => (entry.id === user.id ? updateUserStatus(entry, nextStatus) : entry)),
    );
    setNotice(
      `Simulated — ${user.name} ${
        nextStatus === "Suspended" ? "was suspended" : "was reactivated"
      }. Reload to reset demo data.`,
    );
    setPendingStatusUser(null);
  }

  function copyUserId(user: DemoUserSummary) {
    void navigator.clipboard
      .writeText(user.id)
      .then(() => {
        setNotice("Simulated — user ID copied to your clipboard.");
      })
      .catch(() => {
        setNotice("Copy failed — select the ID from the profile instead.");
      });
  }

  function renderRowActions(user: DemoUserSummary, openUp = false) {
    return (
      <RowActions
        base={base}
        isOpen={openMenuId === user.id}
        onClose={() => {
          setOpenMenuId(null);
        }}
        onCopy={() => {
          copyUserId(user);
        }}
        onToggleMenu={() => {
          setOpenMenuId((current) => (current === user.id ? null : user.id));
        }}
        onToggleStatus={() => {
          setPendingStatusUser(user);
        }}
        openUp={openUp}
        user={user}
      />
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Registered accounts"
        title="Users."
        description="Find one registered person once, understand every role, and handle common support work without leaving the record."
        updatedAt={data.updatedAt}
      />

      <section className={styles.toolbar} aria-label="Filter registered users">
        <input
          aria-label="Search registered users"
          className={styles.search}
          onChange={(event) => {
            updateFilter(() => {
              setQuery(event.currentTarget.value);
            });
          }}
          placeholder="Search name, email, or Clerk ID…"
          type="search"
          value={query}
        />
        <label className={interactionStyles.selectField}>
          <span>Status</span>
          <select
            onChange={(event) => {
              updateFilter(() => {
                setStatus(event.currentTarget.value as UserStatusFilter);
              });
            }}
            value={status}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="needs-attention">Needs attention</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <div className={styles.filters} aria-label="Role filters">
          {(
            [
              ["all", "All roles"],
              ["producer", "Producers"],
              ["artist", "Artists"],
              ["both", "Both roles"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={role === value}
              className={styles.filter}
              data-active={role === value}
              key={value}
              onClick={() => {
                updateFilter(() => {
                  setRole(value);
                });
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className={interactionStyles.resultBar}>
        <span>
          Showing {firstResult}–{lastResult} of {filteredUsers.length} registered users
        </span>
        {hasFilters ? (
          <button
            onClick={() => {
              setQuery("");
              setRole("all");
              setStatus("all");
              setPage(1);
            }}
            type="button"
          >
            Reset filters
          </button>
        ) : null}
      </div>

      {filteredUsers.length === 0 ? (
        <section className={styles.panel}>
          <EmptyState>
            No registered demo account matches these filters. Reset them to see all users.
          </EmptyState>
        </section>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {(
                    [
                      ["name", "Person"],
                      ["roles", "Role"],
                      ["status", "Status"],
                      ["onboarding", "Onboarding"],
                      ["activation", "Activation"],
                      ["lastActivity", "Last activity"],
                    ] as const
                  ).map(([key, label]) => (
                    <th key={key}>
                      <SortButton
                        activeDirection={sortKey === key ? sortDirection : null}
                        onSort={() => {
                          changeSort(key);
                        }}
                      >
                        {label}
                      </SortButton>
                    </th>
                  ))}
                  <th>
                    <span className={interactionStyles.visuallyHidden}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagination.items.map((user, index) => (
                  <tr key={user.id}>
                    <td>
                      <div className={styles.identity}>
                        <span className={styles.avatar} aria-hidden="true">
                          {user.initials}
                        </span>
                        <div>
                          <Link className={styles.recordLink} href={`${base}/${user.id}`}>
                            {user.name}
                          </Link>
                          <span>{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={styles.badges}>
                        {user.roles.map((userRole) => (
                          <Badge key={userRole}>{userRole}</Badge>
                        ))}
                      </span>
                    </td>
                    <td>
                      <Badge tone={accountTone(user.status)}>{user.status}</Badge>
                    </td>
                    <td>{user.onboarding}</td>
                    <td>{user.activation}</td>
                    <td className={styles.itemTime}>{user.lastActivity}</td>
                    <td>{renderRowActions(user, index === pagination.items.length - 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileCards} aria-label="Registered users">
            {pagination.items.map((user) => (
              <article className={styles.mobileCard} key={user.id}>
                <div className={interactionStyles.mobileCardTop}>
                  <div className={styles.identity}>
                    <span className={styles.avatar} aria-hidden="true">
                      {user.initials}
                    </span>
                    <div>
                      <Link className={styles.recordLink} href={`${base}/${user.id}`}>
                        {user.name}
                      </Link>
                      <span>{user.email}</span>
                    </div>
                  </div>
                  {renderRowActions(user)}
                </div>
                <div className={styles.badges}>
                  {user.roles.map((userRole) => (
                    <Badge key={userRole}>{userRole}</Badge>
                  ))}
                  <Badge tone={accountTone(user.status)}>{user.status}</Badge>
                </div>
                <div className={styles.mobileCardMeta}>
                  <span>{user.activation}</span>
                  <span>{user.lastActivity}</span>
                </div>
              </article>
            ))}
          </div>

          <nav className={interactionStyles.pagination} aria-label="User results pages">
            <button
              disabled={pagination.currentPage === 1}
              onClick={() => {
                setPage((current) => Math.max(1, current - 1));
              }}
              type="button"
            >
              Previous
            </button>
            <span>
              Page {pagination.currentPage} of {pagination.pageCount}
            </span>
            <button
              disabled={pagination.currentPage === pagination.pageCount}
              onClick={() => {
                setPage((current) => Math.min(pagination.pageCount, current + 1));
              }}
              type="button"
            >
              Next
            </button>
          </nav>
        </>
      )}

      {pendingStatusUser ? (
        <ReasonActionDialog
          actionLabel={
            pendingStatusUser.status === "Suspended"
              ? "Reactivate simulated account"
              : "Suspend simulated account"
          }
          consequence={
            pendingStatusUser.status === "Suspended"
              ? "The account returns to Active in this demo tab."
              : "The account becomes Suspended in this demo tab. Nothing is sent to Clerk."
          }
          description="Change account access state without changing identity, roles, or stored data."
          onClose={() => {
            setPendingStatusUser(null);
          }}
          onConfirm={() => {
            confirmStatusChange(pendingStatusUser);
          }}
          title={
            pendingStatusUser.status === "Suspended"
              ? `Reactivate ${pendingStatusUser.name}?`
              : `Suspend ${pendingStatusUser.name}?`
          }
          tone={pendingStatusUser.status === "Suspended" ? "default" : "danger"}
        />
      ) : null}

      <DemoToast
        message={notice}
        onDismiss={() => {
          setNotice(null);
        }}
      />
    </div>
  );
}

type ProfileDialog =
  | "cancel-deletion"
  | "delete"
  | "edit"
  | "email"
  | "note"
  | "onboarding"
  | "public-page"
  | "status"
  | null;

function EditSupportDialog({
  displayName,
  email,
  onClose,
  onSave,
  roles,
  tags,
}: {
  displayName: string;
  email: string;
  onClose: () => void;
  onSave: (next: { displayName: string; tags: string[] }) => void;
  roles: readonly string[];
  tags: readonly string[];
}) {
  const [nextName, setNextName] = useState(displayName);
  const [tagsInput, setTagsInput] = useState(tags.join(", "));
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = validateSupportDetails({ displayName: nextName, tagsInput, reason });

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (hasValidationErrors(errors)) return;
    onSave({
      displayName: nextName.trim(),
      tags: normalizeSupportTags(tagsInput),
    });
  }

  return (
    <Modal
      description="Only the support display name and internal tags can change here. Registered identity and roles stay locked."
      onClose={onClose}
      title="Edit support details"
    >
      <form className={interactionStyles.form} onSubmit={submit}>
        <label className={interactionStyles.field}>
          <span>Support display name</span>
          <input
            autoFocus
            onChange={(event) => {
              setNextName(event.currentTarget.value);
            }}
            value={nextName}
          />
          {submitted && errors.displayName ? (
            <small className={interactionStyles.error}>{errors.displayName}</small>
          ) : null}
        </label>
        <label className={interactionStyles.field}>
          <span>Internal support tags</span>
          <input
            onChange={(event) => {
              setTagsInput(event.currentTarget.value);
            }}
            placeholder="onboarding, payment follow-up"
            value={tagsInput}
          />
          <small>Comma separated · up to 5 tags</small>
          {submitted && errors.tagsInput ? (
            <small className={interactionStyles.error}>{errors.tagsInput}</small>
          ) : null}
        </label>
        <div className={interactionStyles.readonlyGrid}>
          <label className={interactionStyles.field}>
            <span>Registered email · read only</span>
            <input readOnly value={email} />
          </label>
          <label className={interactionStyles.field}>
            <span>Roles · read only</span>
            <input readOnly value={roles.join(" + ")} />
          </label>
        </div>
        <label className={interactionStyles.field}>
          <span>Reason for this edit</span>
          <textarea
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
            placeholder="Explain why support needs this correction…"
            rows={3}
            value={reason}
          />
          {submitted && errors.reason ? (
            <small className={interactionStyles.error}>{errors.reason}</small>
          ) : null}
        </label>
        <div className={interactionStyles.modalActions}>
          <button className={interactionStyles.secondaryButton} onClick={onClose} type="button">
            Cancel
          </button>
          <button className={interactionStyles.primaryButton} type="submit">
            Save simulated edit
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SupportNoteDialog({
  onAdd,
  onClose,
}: {
  onAdd: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const error = validateSupportNote(note);

  return (
    <Modal
      description="Support notes are append-only. After this simulated note is added, it cannot be edited or deleted."
      onClose={onClose}
      title="Add support note"
    >
      <form
        className={interactionStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (error) return;
          onAdd(note);
        }}
      >
        <label className={interactionStyles.field}>
          <span>Internal note</span>
          <textarea
            autoFocus
            maxLength={500}
            onChange={(event) => {
              setNote(event.currentTarget.value);
            }}
            placeholder="Add useful context for the next support review…"
            rows={6}
            value={note}
          />
          <small>{note.length}/500 characters</small>
          {submitted && error ? <small className={interactionStyles.error}>{error}</small> : null}
        </label>
        <div className={interactionStyles.modalActions}>
          <button className={interactionStyles.secondaryButton} onClick={onClose} type="button">
            Cancel
          </button>
          <button className={interactionStyles.primaryButton} type="submit">
            Add simulated note
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReasonActionDialog({
  actionLabel,
  consequence,
  description,
  onClose,
  onConfirm,
  title,
  tone = "default",
}: {
  actionLabel: string;
  consequence: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  tone?: "danger" | "default";
}) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const error = validateRequiredReason(reason);

  return (
    <Modal description={description} onClose={onClose} title={title}>
      <form
        className={interactionStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (error) return;
          onConfirm();
        }}
      >
        <div className={interactionStyles.consequence}>
          <strong>What changes</strong>
          <p>{consequence}</p>
        </div>
        <label className={interactionStyles.field}>
          <span>Admin reason</span>
          <textarea
            autoFocus
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
            placeholder="Explain why this action is needed…"
            rows={3}
            value={reason}
          />
          {submitted && error ? <small className={interactionStyles.error}>{error}</small> : null}
        </label>
        <div className={interactionStyles.modalActions}>
          <button className={interactionStyles.secondaryButton} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className={
              tone === "danger" ? interactionStyles.dangerButton : interactionStyles.primaryButton
            }
            type="submit"
          >
            {actionLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OnboardingDialog({
  current,
  onClose,
  onSave,
}: {
  current: DemoUserSummary["onboarding"];
  onClose: () => void;
  onSave: (value: DemoUserSummary["onboarding"]) => void;
}) {
  const [nextState, setNextState] = useState(current);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const error = validateRequiredReason(reason);

  return (
    <Modal
      description="Restart onboarding or correct its recorded state. Roles and identity are not changed."
      onClose={onClose}
      title="Correct onboarding"
    >
      <form
        className={interactionStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (error) return;
          onSave(nextState);
        }}
      >
        <label className={interactionStyles.field}>
          <span>Onboarding state</span>
          <select
            autoFocus
            onChange={(event) => {
              setNextState(event.currentTarget.value as DemoUserSummary["onboarding"]);
            }}
            value={nextState}
          >
            <option value="Not started">Restart · not started</option>
            <option value="In progress">In progress</option>
            <option value="Complete">Complete</option>
          </select>
        </label>
        <label className={interactionStyles.field}>
          <span>Admin reason</span>
          <textarea
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
            placeholder="Explain the correction…"
            rows={3}
            value={reason}
          />
          {submitted && error ? <small className={interactionStyles.error}>{error}</small> : null}
        </label>
        <div className={interactionStyles.modalActions}>
          <button className={interactionStyles.secondaryButton} onClick={onClose} type="button">
            Cancel
          </button>
          <button className={interactionStyles.primaryButton} type="submit">
            Save simulated state
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeletionDialog({
  email,
  onClose,
  onSchedule,
}: {
  email: string;
  onClose: () => void;
  onSchedule: () => void;
}) {
  const [reason, setReason] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = validateWorkspaceDeletion({
    reason,
    registeredEmail: email,
    typedEmail,
  });

  return (
    <Modal
      description="This schedules a reversible demo deletion with a 7-day grace period. It never hard-deletes anything."
      onClose={onClose}
      title="Schedule workspace deletion"
    >
      <form
        className={interactionStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (hasValidationErrors(errors)) return;
          onSchedule();
        }}
      >
        <div className={interactionStyles.dangerPreview}>
          <strong>Consequence preview</strong>
          <ul>
            <li>The workspace enters a 7-day grace period.</li>
            <li>Deletion can be cancelled until 05 Aug 2026.</li>
            <li>After the grace period, workspace access and the public page would be removed.</li>
            <li>Payment records would stay preserved for support history.</li>
          </ul>
        </div>
        <label className={interactionStyles.field}>
          <span>Reason for deletion</span>
          <textarea
            autoFocus
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
            placeholder="Explain why this workspace should be scheduled…"
            rows={3}
            value={reason}
          />
          {submitted && errors.reason ? (
            <small className={interactionStyles.error}>{errors.reason}</small>
          ) : null}
        </label>
        <label className={interactionStyles.field}>
          <span>
            Type <code>{email}</code> exactly
          </span>
          <input
            autoComplete="off"
            onChange={(event) => {
              setTypedEmail(event.currentTarget.value);
            }}
            value={typedEmail}
          />
          {submitted && errors.typedEmail ? (
            <small className={interactionStyles.error}>{errors.typedEmail}</small>
          ) : null}
        </label>
        <div className={interactionStyles.modalActions}>
          <button className={interactionStyles.secondaryButton} onClick={onClose} type="button">
            Keep workspace
          </button>
          <button className={interactionStyles.dangerButton} type="submit">
            Schedule simulated deletion
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UserProfileView({
  data,
  tab: initialTab,
}: {
  data: DemoUserProfile;
  tab: ProfileTab;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [user, setUser] = useState(data.user);
  const [displayName, setDisplayName] = useState(data.supportDisplayName);
  const [supportTags, setSupportTags] = useState<string[]>(() => [...data.supportTags]);
  const [supportNotes, setSupportNotes] = useState<DemoSupportNote[]>(() => [...data.supportNotes]);
  const [publicPage, setPublicPage] = useState(data.user.publicPage);
  const [emailDelivery, setEmailDelivery] = useState<DemoUserSummary["emailDelivery"] | "Queued">(
    data.user.emailDelivery,
  );
  const [deletionDate, setDeletionDate] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ProfileDialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const summaryFacts = data.summary.map((fact) => {
    if (fact.label === "Onboarding") return { ...fact, value: user.onboarding };
    if (fact.label === "Activation") return { ...fact, value: user.activation };
    return fact;
  });
  const supportFacts = [
    { label: "Support display name", value: displayName },
    {
      label: "Internal tags",
      value: supportTags.length === 0 ? "No tags" : supportTags.join(" · "),
    },
    { label: "Registered email", value: user.email },
    { label: "Roles", value: user.roles.join(" + ") },
    { label: "Public page", value: publicPage },
    { label: "Email delivery", value: emailDelivery },
  ];

  function simulatedSuccess(message: string) {
    setDialog(null);
    setNotice(`Simulated — ${message} Reload to reset demo data.`);
  }

  function copyId() {
    void navigator.clipboard
      .writeText(user.id)
      .then(() => {
        setNotice("Simulated — user ID copied to your clipboard.");
      })
      .catch(() => {
        setNotice("Copy failed — select the Clerk identity value instead.");
      });
  }

  function selectProfileTab(nextTab: ProfileTab) {
    setActiveTab(nextTab);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextTab === "summary") nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, {
      scroll: false,
    });
  }

  const panelTitle =
    activeTab === "summary"
      ? "Account summary"
      : activeTab === "activity"
        ? "Meaningful activity"
        : activeTab === "business"
          ? "Business state"
          : "Support context";

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Registered account"
        title={displayName}
        description="One identity across producer and artist roles. Common support actions are available as safe in-memory simulations."
        updatedAt={data.updatedAt}
      />

      <section className={styles.profileHeader}>
        <div className={styles.profileIdentity}>
          <span className={styles.avatar} aria-hidden="true">
            {user.initials}
          </span>
          <div>
            <h2>{displayName}</h2>
            <p>{user.email}</p>
          </div>
        </div>
        <div className={interactionStyles.profileHeaderActions}>
          <div className={styles.badges}>
            {user.roles.map((role) => (
              <Badge key={role}>{role}</Badge>
            ))}
            <Badge tone={accountTone(user.status)}>{user.status}</Badge>
          </div>
          <button className={interactionStyles.secondaryButton} onClick={copyId} type="button">
            Copy user ID
          </button>
        </div>
      </section>

      <nav className={styles.tabs} aria-label="User profile sections">
        {PROFILE_TABS.map((profileTab) => (
          <button
            aria-current={activeTab === profileTab ? "page" : undefined}
            className={styles.tab}
            data-active={activeTab === profileTab}
            key={profileTab}
            onClick={() => {
              selectProfileTab(profileTab);
            }}
            type="button"
          >
            {profileTab[0]?.toUpperCase()}
            {profileTab.slice(1)}
          </button>
        ))}
      </nav>

      <div className={styles.profileGrid}>
        <Panel title={panelTitle} meta="In-memory demo">
          {activeTab === "activity" ? (
            <ul className={styles.activityList}>
              {data.activity.map((activity) => (
                <li className={styles.activityItem} key={activity.id}>
                  <span
                    aria-hidden="true"
                    className={styles.activityDot}
                    data-tone={activity.tone}
                  />
                  <div>
                    <p className={styles.itemTitle}>{activity.label}</p>
                    <p className={styles.itemDetail}>{activity.detail}</p>
                  </div>
                  <span className={styles.itemTime}>{activity.occurredAt}</span>
                </li>
              ))}
            </ul>
          ) : activeTab === "support" ? (
            <div className={interactionStyles.supportPanel}>
              <dl className={styles.detailList}>
                {supportFacts.map((fact) => (
                  <div className={styles.detailRow} key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <section className={interactionStyles.noteLedger}>
                <header>
                  <div>
                    <h3>Append-only support notes</h3>
                    <p>Notes can be added, never edited or deleted.</p>
                  </div>
                  <Badge>{supportNotes.length}</Badge>
                </header>
                {supportNotes.length === 0 ? (
                  <p className={interactionStyles.noteEmpty}>No support notes yet.</p>
                ) : (
                  <ol>
                    {supportNotes.map((note) => (
                      <li key={note.id}>
                        <p>{note.body}</p>
                        <span>
                          {note.author} · {note.addedAt}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          ) : (
            <dl className={styles.detailList}>
              {(activeTab === "summary" ? summaryFacts : data.business).map((fact) => (
                <div className={styles.detailRow} key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <aside className={styles.actionRail}>
          <header className={styles.actionRailHeader}>
            <h3>Account controls</h3>
            <p>Every action below is simulated in this tab only. No API request will run.</p>
          </header>
          <div className={styles.actionList}>
            <button
              className={interactionStyles.actionButton}
              onClick={() => {
                setDialog("edit");
              }}
              type="button"
            >
              <span>Edit support details</span>
              <small>Name and tags only</small>
            </button>
            <button
              className={interactionStyles.actionButton}
              onClick={() => {
                setDialog("note");
              }}
              type="button"
            >
              <span>Add support note</span>
              <small>Append-only</small>
            </button>
            <button
              className={interactionStyles.actionButton}
              data-tone={user.status === "Suspended" ? "positive" : "danger"}
              onClick={() => {
                setDialog("status");
              }}
              type="button"
            >
              <span>{user.status === "Suspended" ? "Reactivate account" : "Suspend account"}</span>
              <small>Current · {user.status}</small>
            </button>
            <button
              className={interactionStyles.actionButton}
              onClick={() => {
                setDialog("public-page");
              }}
              type="button"
            >
              <span>{publicPage === "Visible" ? "Hide public page" : "Restore public page"}</span>
              <small>Current · {publicPage}</small>
            </button>
            <button
              className={interactionStyles.actionButton}
              onClick={() => {
                setDialog("onboarding");
              }}
              type="button"
            >
              <span>Correct onboarding</span>
              <small>Current · {user.onboarding}</small>
            </button>
            <button
              className={interactionStyles.actionButton}
              onClick={() => {
                setDialog("email");
              }}
              type="button"
            >
              <span>
                {emailDelivery === "Failed" ? "Retry failed email" : "Resend account email"}
              </span>
              <small>Delivery · {emailDelivery}</small>
            </button>
          </div>
          <div className={styles.dangerZone}>
            <p className={styles.dangerLabel}>Danger zone</p>
            {deletionDate ? (
              <div className={interactionStyles.deletionScheduled}>
                <strong>Deletion scheduled</strong>
                <span>Grace period ends {deletionDate}</span>
                <button
                  onClick={() => {
                    setDialog("cancel-deletion");
                  }}
                  type="button"
                >
                  Cancel scheduled deletion
                </button>
              </div>
            ) : (
              <button
                className={interactionStyles.dangerAction}
                onClick={() => {
                  setDialog("delete");
                }}
                type="button"
              >
                Schedule workspace deletion
              </button>
            )}
          </div>
        </aside>
      </div>

      {dialog === "edit" ? (
        <EditSupportDialog
          displayName={displayName}
          email={user.email}
          onClose={() => {
            setDialog(null);
          }}
          onSave={(next) => {
            setDisplayName(next.displayName);
            setSupportTags(next.tags);
            simulatedSuccess("support details were updated.");
          }}
          roles={user.roles}
          tags={supportTags}
        />
      ) : null}
      {dialog === "note" ? (
        <SupportNoteDialog
          onAdd={(note) => {
            setSupportNotes((current) =>
              appendSupportNote(current, {
                id: `${user.id}_support_note_${String(current.length + 1)}`,
                body: note,
                addedAt: "Just now",
              }),
            );
            selectProfileTab("support");
            simulatedSuccess("a support note was appended.");
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "status" ? (
        <ReasonActionDialog
          actionLabel={
            user.status === "Suspended"
              ? "Reactivate simulated account"
              : "Suspend simulated account"
          }
          consequence={
            user.status === "Suspended"
              ? "The account returns to Active in this demo tab."
              : "The account becomes Suspended in this demo tab. Nothing is sent to Clerk."
          }
          description="Change account access state without changing identity, roles, or stored data."
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            const next = user.status === "Suspended" ? "Active" : "Suspended";
            setUser((current) => updateUserStatus(current, next));
            simulatedSuccess(`the account was ${next === "Active" ? "reactivated" : "suspended"}.`);
          }}
          title={user.status === "Suspended" ? "Reactivate account" : "Suspend account"}
          tone={user.status === "Suspended" ? "default" : "danger"}
        />
      ) : null}
      {dialog === "public-page" ? (
        <ReasonActionDialog
          actionLabel={`${publicPage === "Visible" ? "Hide" : "Restore"} simulated page`}
          consequence={
            publicPage === "Visible"
              ? "The public booking page becomes Hidden in this demo tab."
              : "The public booking page becomes Visible in this demo tab."
          }
          description="Change only the public page visibility. The account and workspace remain available."
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            const next = publicPage === "Visible" ? "Hidden" : "Visible";
            setPublicPage(next);
            simulatedSuccess(`the public page is now ${next.toLowerCase()}.`);
          }}
          title={publicPage === "Visible" ? "Hide public page" : "Restore public page"}
          tone={publicPage === "Visible" ? "danger" : "default"}
        />
      ) : null}
      {dialog === "onboarding" ? (
        <OnboardingDialog
          current={user.onboarding}
          onClose={() => {
            setDialog(null);
          }}
          onSave={(nextState) => {
            setUser((current) => ({ ...current, onboarding: nextState }));
            simulatedSuccess(`onboarding was set to ${nextState.toLowerCase()}.`);
          }}
        />
      ) : null}
      {dialog === "email" ? (
        <ReasonActionDialog
          actionLabel={
            emailDelivery === "Failed" ? "Retry simulated email" : "Resend simulated email"
          }
          consequence={`An account email is queued to ${user.email}. No provider request will run.`}
          description={
            emailDelivery === "Failed"
              ? "Retry the supported failed-delivery fixture."
              : "Queue another copy of the latest account email."
          }
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            setEmailDelivery("Queued");
            simulatedSuccess("the account email was queued.");
          }}
          title={emailDelivery === "Failed" ? "Retry failed email" : "Resend account email"}
        />
      ) : null}
      {dialog === "delete" ? (
        <DeletionDialog
          email={user.email}
          onClose={() => {
            setDialog(null);
          }}
          onSchedule={() => {
            setDeletionDate("05 Aug 2026");
            simulatedSuccess("workspace deletion was scheduled with a 7-day grace period.");
          }}
        />
      ) : null}
      {dialog === "cancel-deletion" ? (
        <ReasonActionDialog
          actionLabel="Cancel simulated deletion"
          consequence="The workspace leaves the deletion grace period and remains available."
          description="Cancel the scheduled deletion before the 7-day grace period ends."
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            setDeletionDate(null);
            simulatedSuccess("the scheduled workspace deletion was cancelled.");
          }}
          title="Cancel scheduled deletion"
        />
      ) : null}

      <DemoToast
        message={notice}
        onDismiss={() => {
          setNotice(null);
        }}
      />
    </div>
  );
}
