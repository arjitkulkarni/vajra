"use client";

/**
 * THE METRICS BAND — eight numbers, every one of them countable from the repository.
 *
 * The counts are not decoration and they are not the deck's word for it. Each was re-derived
 * against the working tree, and the method is written next to it in the comment below so a reviewer
 * can run the same command:
 *
 *   35,109  git ls-files '*.ts' '*.tsx' | xargs wc -l  →  35,005, plus apps/risk/main.py at 104
 *      121  what `pnpm test` reports across the ten *.test.ts files. NOT the 117 the README and
 *           the deck carry: that figure came from grepping for `it(`, which misses the four cases
 *           `antispoof.test.ts` generates with `it.each`. The command under the number is the one
 *           a reviewer will run, so the number is the one it prints.
 *       87  the `check(` calls in apps/gateway/scripts/e2e.ts       → `pnpm e2e`
 *       59  app.<method>("…") route registrations in apps/gateway/src
 *       27  pgTable(…) declarations in apps/gateway/src/db/schema.ts
 *        5  contracts exported from packages/chain-logic/src/index.ts and the Fabric adapter
 *        3  apps/web/src/i18n/{en,hi,kn}.ts
 *     <300  asserted, not estimated: e2e.ts checks `latencyMs < 300`, and gateway.test.ts repeats
 *           it. It is a single-machine figure, so the copy says "asserted" and not "p95".
 *
 * `CountUp` animates from zero on mount, so the band is not mounted until it is on screen —
 * otherwise every number has finished counting long before anybody scrolls to it. It also
 * short-circuits to the final value under `prefers-reduced-motion`, which is why there is no second
 * code path here for that.
 */
import { useEffect, useRef, useState } from "react";
import { CountUp, cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

const METRICS = [
  { id: "loc", value: 35109 },
  { id: "unit", value: 121 },
  { id: "e2e", value: 87 },
  { id: "endpoints", value: 59 },
  { id: "tables", value: 27 },
  { id: "contracts", value: 5 },
  { id: "languages", value: 3 },
  { id: "latency", value: 300, prefix: "<", suffix: "ms" },
] as const;

export function Numbers() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-4">
      {METRICS.map((m, i) => (
        <div
          key={m.id}
          className="bg-paper px-4 py-5 transition-[background-color] duration-150 ease-out hover:bg-overlay-1 sm:px-5 sm:py-6"
          style={shown ? { animation: `vajra-rise 460ms ${i * 55}ms var(--ease-out-soft) both` } : undefined}
        >
          <p className={cx("font-display text-[1.75rem] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[2.25rem]")}>
            {"prefix" in m && <span className="text-ink-3">{m.prefix}</span>}
            {shown ? <CountUp value={m.value} duration={900} suffix={"suffix" in m ? m.suffix : undefined} /> : <span className="tnum">0</span>}
          </p>
          <p className="mt-2.5 text-[0.8125rem] font-medium leading-snug text-ink-2">{t(`site.page.numbers.items.${m.id}.label`)}</p>
          <p className="mt-0.5 font-mono text-[0.6875rem] leading-snug text-ink-3">{t(`site.page.numbers.items.${m.id}.hint`)}</p>
        </div>
      ))}
    </div>
  );
}
