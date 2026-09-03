"use client";

/**
 * The employee ID card picker.
 *
 * A bare `<input type="file">` was wrong here twice over. Cosmetically it is the one control on the
 * page the design system cannot reach. More importantly it lies: the form unmounts whenever the
 * flow leaves the "form" stage, so on the way back from an error the native input is a fresh DOM
 * node reading "No file chosen" while the File is still perfectly well held in React state. Someone
 * reading that would re-attach a file they never lost.
 *
 * So the truth comes from state, not from the input: the real input is kept offscreen for the file
 * dialog and keyboard semantics, and what is drawn is the card that is actually attached.
 *
 * The two states are shaped differently on purpose. Empty is a dashed field at the field radius,
 * one overlay step above the ground, that warms to brass on hover and on drag — brass because
 * attaching a card is an ACTION, not a verdict. Attached is a solid row with the thumbnail at the
 * tighter panel radius, because at that point it is evidence rather than an invitation.
 */
import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-client";
import { cx } from "@/components/ui";

const ACCEPT = "image/jpeg,image/png,image/webp";

export function IdCardField({
  file,
  preview,
  onPick,
}: {
  file: File | null;
  preview: string | null;
  onPick: (file: File | null) => void;
}) {
  const { t, bytes } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  /**
   * Cancelling the dialog must not clear an attached card, so only a real file is passed on.
   * The input's own value is reset afterwards: without that, re-picking the *same* file after a
   * remove fires no change event and the field would sit there looking empty.
   */
  const take = (list: FileList | null) => {
    const next = list?.[0] ?? null;
    if (next) onPick(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  if (file && preview) {
    return (
      <div className="auth-panel flex items-center gap-3 rounded-[var(--radius-field)] border border-line bg-overlay-1 p-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview}
          alt={t("signup.idDocument")}
          className="h-16 w-16 shrink-0 rounded-[var(--radius-panel)] border border-line bg-paper-3 object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-medium text-ink">{file.name}</p>
          <p className="tnum mt-0.5 font-mono text-[0.75rem] text-ink-3">{bytes(file.size)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-[var(--radius-control)] px-2.5 py-1.5 text-[0.8125rem] text-ink-2 transition-[color,background-color] duration-150 ease-out hover:bg-paper-2 hover:text-ink active:translate-y-px"
          >
            {t("signup.replaceFile")}
          </button>
          {/* Removing evidence is destructive, so the affordance only turns oxide under the
              pointer — a permanently red control beside an attached card would read as a fault. */}
          <button
            type="button"
            onClick={() => onPick(null)}
            aria-label={t("signup.removeFile")}
            className="rounded-[var(--radius-control)] px-2 py-1.5 text-[0.8125rem] text-ink-3 transition-[color,background-color] duration-150 ease-out hover:bg-oxide-soft hover:text-oxide active:translate-y-px"
          >
            ✕
          </button>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => take(e.target.files)} />
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cx(
          "group flex w-full items-center gap-3 rounded-[var(--radius-field)] border border-dashed px-4 py-5 text-left transition-[color,background-color,border-color] duration-150 ease-out active:translate-y-px",
          over
            ? "border-brass bg-brass-soft/50"
            : "border-line-strong bg-overlay-1 hover:border-brass-line hover:bg-brass-soft/25",
        )}
      >
        <span
          className={cx(
            "grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-pill)] border transition-[color,border-color] duration-150 ease-out",
            over ? "border-brass-line text-brass" : "border-line text-ink-3 group-hover:border-brass-line group-hover:text-brass",
          )}
          aria-hidden
        >
          ↑
        </span>
        <span className="min-w-0">
          <span className="block text-[0.875rem] font-medium text-ink">{t("signup.chooseFile")}</span>
          <span className="block text-[0.75rem] text-ink-3">{t("signup.chooseFileHint")}</span>
        </span>
      </button>
      <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => take(e.target.files)} />
    </div>
  );
}
