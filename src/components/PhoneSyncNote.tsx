import { readPhoneNotice } from "@/lib/phoneNotice";

/** Amber line when a saved phone could not be copied onto the login. */
export default async function PhoneSyncNote() {
  const notice = await readPhoneNotice();
  if (!notice) return null;
  return (
    <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
      {notice}
    </p>
  );
}
