"use client";

/** Small inline delete control: a red link/✕ that confirms before firing a
    (bound) server action. Use for catalog rows, etc. */
export default function DeleteButton({
  action,
  label = "✕",
  confirm = "Delete this? This cannot be undone.",
  className,
}: {
  action: () => Promise<void>;
  label?: string;
  confirm?: string;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      <button
        type="submit"
        className={className ?? "text-xs font-semibold text-red-600 hover:underline dark:text-red-400"}
      >
        {label}
      </button>
    </form>
  );
}
