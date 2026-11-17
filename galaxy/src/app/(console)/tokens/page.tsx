import type { Metadata } from "next";
import { Container, PageHeader, ui } from "../../ui";
import styles from "./page.module.css";

// Token specimen: every swatch reads the live CSS variable from globals.css,
// so this page can't drift from the tokens. Linked from the footer.

const surfaces = [
  "background-layout-main",
  "background-top-navigation",
  "background-container-content",
  "background-cell-shaded",
  "background-input-default",
  "background-button-normal-default",
  "background-button-primary-default",
  "background-dropdown-item-default",
  "background-badge-grey",
  "border-divider-default",
  "border-input-default",
  "border-item-focused",
];

const texts = [
  "text-heading-default",
  "text-body-default",
  "text-body-secondary",
  "text-label",
  "text-form-label",
  "text-link-default",
  "text-link-info-default",
  "text-interactive-default",
  "text-side-navigation-item-active",
  "text-disabled",
];

const statuses = [
  ["success", "Active"],
  ["info", "In review"],
  ["warning", "Payout pending"],
  ["error", "Suspended"],
  ["inactive", "Archived"],
] as const;

const badges = ["blue", "green", "yellow", "red", "grey"] as const;

const typeScale = [
  ["display-l", "Galaxy"],
  ["heading-xl", "Hosts (128)"],
  ["heading-l", "Payouts"],
  ["heading-m", "Fee per host"],
  ["heading-s", "Legal documents"],
  ["heading-xs", "App settings"],
  ["body-m", "Body text sits at 14 on 20."],
  ["body-s", "Small text and footers sit at 12 on 16."],
] as const;

const rows = [
  ["Aanya Rao", "aanya@example.com", "success", "Active", "12 Nov 2026"],
  ["Sunday Run Club", "runclub@example.com", "info", "In review", "14 Nov 2026"],
  ["Jam Circle", "jam@example.com", "error", "Suspended", "2 Oct 2026"],
] as const;

export const metadata: Metadata = { title: "Design tokens" };

export default function Tokens() {
  return (
    <div className={`${ui.page} ${styles.specimen}`}>
      <PageHeader
        title="Design tokens"
        description="Galaxy's dark and light themes, read from the AWS console. Colour, type and space names match Cloudscape's."
      />

      <Container title="Controls">
        <div className={ui.row}>
          <button className={ui.btn}>Edit</button>
          <button className={ui.btn} disabled>
            Delete
          </button>
          <button className={`${ui.btn} ${ui.primary}`}>Verify host</button>
          <button className={`${ui.btn} ${ui.primary}`} disabled>
            Mark paid
          </button>
          <button className={ui.btnLink}>Clear filters</button>
        </div>
        <div className={ui.row}>
          <input className={ui.input} placeholder="Find users" aria-label="Find users" />
          <input className={ui.input} defaultValue="UTR 4021 9933" aria-label="UTR" />
          <input className={ui.input} placeholder="Disabled" aria-label="Disabled" disabled />
        </div>
      </Container>

      <Container title="Status and badges">
        <div className={ui.row}>
          {statuses.map(([kind, label]) => (
            <span key={kind} className={ui.status} style={{ color: `var(--color-text-status-${kind})` }}>
              <span className={ui.dot} />
              {label}
            </span>
          ))}
        </div>
        <div className={ui.row}>
          {badges.map((b) => (
            <span
              key={b}
              className={ui.badge}
              style={{ background: `var(--color-background-badge-${b})`, color: `var(--color-text-badge-${b})` }}
            >
              {b}
            </span>
          ))}
        </div>
      </Container>

      <Container title="Users" count={rows.length}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, email, kind, label, joined]) => (
              <tr key={name}>
                <td>
                  <a href="#about">{name}</a>
                </td>
                <td>{email}</td>
                <td>
                  <span className={ui.status} style={{ color: `var(--color-text-status-${kind})` }}>
                    <span className={ui.dot} />
                    {label}
                  </span>
                </td>
                <td>{joined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Container>

      <Container title="Surfaces and borders">
        <div className={styles.swatches}>
          {surfaces.map((t) => (
            <div key={t} className={styles.swatch}>
              <span className={styles.chip} style={{ background: `var(--color-${t})` }} />
              <code>--color-{t}</code>
            </div>
          ))}
        </div>
      </Container>

      <Container title="Text">
        {texts.map((t) => (
          <p key={t} className={styles.textLine} style={{ color: `var(--color-${t})` }}>
            Discover hosts with a following <code>--color-{t}</code>
          </p>
        ))}
      </Container>

      <Container title="Type scale">
        {typeScale.map(([size, sample]) => (
          <p
            key={size}
            style={{
              fontSize: `var(--font-size-${size})`,
              lineHeight: `var(--line-height-${size})`,
              letterSpacing: `var(--letter-spacing-${size}, normal)`,
              fontFamily: size.startsWith("body") ? undefined : "var(--font-family-heading)",
              fontWeight: size.startsWith("body") ? 400 : size === "heading-xl" || size === "display-l" ? "var(--font-weight-heading-xl)" : "var(--font-weight-heading)",
              color: size.startsWith("body") ? undefined : "var(--color-text-heading-default)",
            }}
          >
            {sample} <code>{size}</code>
          </p>
        ))}
      </Container>

      <p id="about" className={styles.footnote}>
        Fonts follow the Orbit web app: Plus Jakarta Sans for headings, titles and buttons; DM Sans for text.
      </p>
    </div>
  );
}
