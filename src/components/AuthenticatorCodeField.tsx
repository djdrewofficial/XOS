/** The 6-digit authenticator box shared by /2fa, the reset page, and My Account. */
export default function AuthenticatorCodeField({
  value,
  onChange,
  label = "Authenticator code",
  hint,
  autoFocus = false,
  inputClassName = "input w-full",
  placeholder = "6-digit code",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  autoFocus?: boolean;
  inputClassName?: string;
  placeholder?: string;
}) {
  return (
    <div className="mb-4">
      <label className="label-xs">{label}</label>
      <input
        autoFocus={autoFocus}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className={inputClassName}
        placeholder={placeholder}
      />
      {hint ? <p className="mt-1 text-[11px] leading-snug text-zinc-500">{hint}</p> : null}
    </div>
  );
}
