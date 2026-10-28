import { PASSWORD_RULES } from "@/lib/passwordPolicy";

/** Live requirement checklist — mirrors the Supabase Auth password policy. */
export default function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mb-4 space-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.key}
            className={`flex items-center gap-2 text-xs ${
              met ? "text-green-600 dark:text-green-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            <span aria-hidden className="w-3 text-center">
              {met ? "✓" : "○"}
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
