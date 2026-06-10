"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-sm p-8"
      >
        <h1 className="mb-1 text-4xl font-black tracking-tight text-white">
          X
          <span className="bg-gradient-to-r from-brand-light to-brand-lighter bg-clip-text text-transparent">
            OS
          </span>
        </h1>
        <p className="mb-8 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">
          Xpress Entertainment
        </p>
        <label className="label-xs">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4 w-full"
        />
        <label className="label-xs">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-5 w-full"
        />
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Log On"}
        </button>
      </form>
    </div>
  );
}
