import { AppShell } from "@/components/AppShell";

/**
 * The workspace an approved engineer, manager or auditor lands in — the same console components as
 * /admin, with the governance pages left out. `AppShell` in "workspace" mode picks the nav; the
 * pages themselves are shared, resolving their links through `useConsoleBase()`.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AppShell variant="workspace">{children}</AppShell>;
}
