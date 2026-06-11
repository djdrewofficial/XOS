export default function SettingsPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-3xl">
      <h1 className="page-title mb-2">{title}</h1>
      <p className="mb-6 text-sm text-zinc-500">{description}</p>
      <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <div className="text-3xl">🚧</div>
        <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Coming soon</div>
        <p className="max-w-md text-xs text-zinc-500">
          This settings area is a placeholder — we&apos;ll build it out next. Tell me when you want to start on it.
        </p>
      </div>
    </div>
  );
}
