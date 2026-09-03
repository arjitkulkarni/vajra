"use client";

/**
 * Two consoles, one set of pages.
 *
 * `/[locale]/admin` is the control plane — everything, for administrators. `/[locale]/app` is the
 * workspace an approved engineer, manager or auditor lands in: the same components, a smaller
 * surface, and no page that would let someone govern their own access.
 *
 * Every internal link resolves against `useConsoleBase()` rather than a hard-coded `/app`, so the
 * shared pages render correctly under either root, and `linkable()` hides deep links to pages the
 * current area does not have.
 */
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n-client";

export type ConsoleArea = "admin" | "workspace";

/** Sections the workspace carries. Anything outside this list exists only under /admin. */
const WORKSPACE_PATHS = ["", "/vault", "/assets", "/access", "/approvals", "/activity", "/verify"] as const;

/**
 * Work waiting on this operator, named rather than counted here: nav.ts is a static model and the
 * numbers are live. AppShell does the fetching and hangs the count off this key, so a nav item
 * declares "I have a queue" without nav.ts learning how to talk to the gateway.
 */
export type NavBadge = "signups" | "approvals";

export interface NavItem {
  key: string;
  href: string;
  badge?: NavBadge;
}

export interface NavSection {
  group: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    group: "controlPlane",
    items: [
      { key: "overview", href: "" },
      { key: "activity", href: "/activity" },
      { key: "incidents", href: "/incidents" },
    ],
  },
  {
    group: "access",
    items: [
      { key: "requests", href: "/access" },
      { key: "approvals", href: "/approvals", badge: "approvals" },
      { key: "policies", href: "/policies" },
    ],
  },
  { group: "assets", items: [{ key: "registry", href: "/vault" }] },
  {
    group: "identity",
    items: [
      { key: "signups", href: "/signups", badge: "signups" },
      { key: "people", href: "/identities" },
      { key: "devices", href: "/devices" },
    ],
  },
  {
    group: "evidence",
    items: [
      { key: "audit", href: "/audit" },
      { key: "proofs", href: "/verify" },
      { key: "timetravel", href: "/timetravel" },
    ],
  },
  {
    group: "system",
    items: [
      { key: "health", href: "/system" },
      { key: "settings", href: "/settings" },
    ],
  },
];

/** No badges here on purpose: the counts are the administrator's backlog, not the workspace's. */
const WORKSPACE_NAV: NavSection[] = [
  {
    group: "controlPlane",
    items: [
      { key: "overview", href: "" },
      { key: "activity", href: "/activity" },
    ],
  },
  {
    group: "access",
    items: [
      { key: "requests", href: "/access" },
      { key: "approvals", href: "/approvals" },
    ],
  },
  { group: "assets", items: [{ key: "registry", href: "/vault" }] },
  { group: "evidence", items: [{ key: "proofs", href: "/verify" }] },
];

export const navFor = (area: ConsoleArea): NavSection[] => (area === "admin" ? NAV : WORKSPACE_NAV);

/** Which console the current URL is inside. Defaults to the workspace. */
export function useConsoleArea(): ConsoleArea {
  const { locale } = useI18n();
  const pathname = usePathname() ?? "";
  return pathname.startsWith(`/${locale}/admin`) ? "admin" : "workspace";
}

/** The root every internal link in a shared page hangs off. */
export function useConsoleBase(): string {
  const { locale } = useI18n();
  return `/${locale}/${useConsoleArea() === "admin" ? "admin" : "app"}`;
}

/** False when this area has no page at that path, so a deep link can be left out rather than 404. */
export function linkable(area: ConsoleArea, path: string): boolean {
  if (area === "admin") return true;
  const head = `/${path.replace(/^\//, "").split(/[/?]/)[0] ?? ""}`.replace(/^\/$/, "");
  return (WORKSPACE_PATHS as readonly string[]).includes(head);
}
