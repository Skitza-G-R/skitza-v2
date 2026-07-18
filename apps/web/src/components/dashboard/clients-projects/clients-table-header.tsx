// Column header for the automatic compact Clients roster. Mockup-match
// against /Volumes/KINGSTON/Downloads/Clients Projects Room.html
// table view — 5 data columns (Client / Email / Link / Projects /
// Joined) plus avatar + actions utility columns.
//
// Only columns with truthful local semantics are sortable. Currency-
// separated money remains display-only here until the list owns that
// projection. Width units mirror ClientCompactRow's grid.

interface ColumnSpec {
  label: string;
  align?: "left" | "right";
}

// Column lineup (matches ClientCompactRow's grid exactly):
//   44px(avatar) minmax(0,1.4fr)(client name)
//   minmax(0,1.5fr)(email) 110px(link state)
//   90px(projects) 110px(joined) 44px(actions)
const COLUMNS: ColumnSpec[] = [
  { label: "" }, // avatar
  { label: "Client", align: "left" },
  { label: "Email", align: "left" },
  { label: "Link", align: "left" },
  { label: "Projects", align: "right" },
  { label: "Joined", align: "left" },
  { label: "", align: "right" },
];

const GRID_TEMPLATE = "44px minmax(0,1.4fr) minmax(0,1.5fr) 110px 90px 110px 44px";

// Shared with ClientCompactRow so the header + rows align.
export const CLIENTS_TABLE_GRID = GRID_TEMPLATE;

export function ClientsTableHeader() {
  return (
    <div
      data-testid="clients-table-header"
      aria-hidden="true"
      // Hidden below xl — the fixed data tracks need real desktop width,
      // especially once the expanded sidebar is taken into account.
      // Smaller screens render ClientCompactRow as a compact card row.
      // 2-line card, so the desktop header has nothing to align with.
      className="hidden items-center gap-3 border-b px-3 py-2.5 xl:grid"
      style={{
        gridTemplateColumns: GRID_TEMPLATE,
        borderBottomColor: "rgb(var(--border-subtle))",
        background: "rgb(var(--bg-background) / 0.6)",
      }}
    >
      {COLUMNS.map((col, i) => {
        const alignClass = col.align === "right" ? "text-right" : "text-left";
        return (
          <div
            key={`col-${String(i)}`}
            className={`min-w-0 text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase ${alignClass}`}
          >
            {col.label}
          </div>
        );
      })}
    </div>
  );
}
