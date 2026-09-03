import { AdminGate } from "@/components/AdminGate";

export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
