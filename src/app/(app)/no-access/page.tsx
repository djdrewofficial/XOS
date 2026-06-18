import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";
import { getMe } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const me = await getMe();
  const home = me?.landing || "/";
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10 text-2xl text-brand dark:text-brand-lighter">
        <FontAwesomeIcon icon={faLock} />
      </div>
      <h1 className="page-title mb-2">No access to this screen</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Your account doesn&apos;t have permission to view this part of XOS. If you think this is a
        mistake, ask an administrator to update your permissions.
      </p>
      <Link href={home} className="btn-primary px-5 py-2 text-sm">
        Go to my home screen
      </Link>
    </div>
  );
}
