import ChangePasswordForm from "@/components/ChangePasswordForm";

/** Signed-in password change. Shared by My Account and My Account → Security. */
export default function ChangePasswordSection() {
  return (
    <div id="change-password" className="card scroll-mt-24 p-6">
      <h2 className="card-title mb-1">Change password</h2>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Choose a new password for your XOS login. You&apos;ll stay signed in here; other devices will be signed out.
      </p>
      <ChangePasswordForm />
    </div>
  );
}
