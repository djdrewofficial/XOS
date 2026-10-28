"use client";

import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { requestPasswordReset } from "./actions";

const SENT =
  "If an account exists for that email, a password reset link is on its way. Check your inbox.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await requestPasswordReset(email);
    setLoading(false);
    setSent(true);
  }

  return (
    <AuthShell subtitle="XOS · Xpress Operating System">
      <form onSubmit={handleSubmit}>
        <h1 className="mb-2 text-center text-sm font-semibold text-zinc-800 dark:text-zinc-100">Reset your password</h1>
        <p className="mb-5 text-center text-xs leading-relaxed text-zinc-500">
          Enter the email on your account. If we have a match, we&apos;ll send a link to choose a new password.
        </p>
        <label className="label-xs">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={sent}
          className="input mb-5 w-full disabled:opacity-60"
        />
        {sent ? (
          <p className="mb-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {SENT}
          </p>
        ) : (
          <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
            {loading ? "Sending…" : "Send reset email"}
          </button>
        )}
        <Link href="/login" className="mt-4 block w-full text-center text-xs text-zinc-500 hover:underline">
          ← Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
