import { DemoScenarioSchema, type DemoScenario } from "@vajra/contracts";
import type { Config } from "../../config";

export const SCENARIO_HEADER = "x-vajra-demo-context";

/** DEMO_MODE only: lets one laptop impersonate "a new device in Mumbai at 02:00". */
export function parseScenario(config: Config, headers: Record<string, unknown>): DemoScenario | null {
  if (!config.DEMO_MODE) return null;
  const raw = headers[SCENARIO_HEADER];
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = DemoScenarioSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const PRESETS: Record<string, DemoScenario & { label: string }> = {
  trusted: { label: "Trusted engineer, office hours, known laptop", localHour: 11, geo: { lat: 12.9716, lng: 77.5946, city: "Bengaluru" }, ip: "49.207.10.12" },
  attacker: { label: "New device, Mumbai IP, 02:00, request burst", deviceId: "unknown-device-7f3a", localHour: 2, geo: { lat: 19.076, lng: 72.8777, city: "Mumbai" }, ip: "103.21.58.90", burst: 47 },
  odd_hours: { label: "Known laptop, 23:00, home city", localHour: 23, geo: { lat: 12.9716, lng: 77.5946, city: "Bengaluru" } },
  travel: { label: "Known laptop, Delhi IP minutes after Bengaluru", localHour: 11, geo: { lat: 28.6139, lng: 77.209, city: "New Delhi" }, ip: "122.176.5.9" },
};
