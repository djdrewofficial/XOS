import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("clients").select("*").order("first_name").limit(500);
  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);
  const { data: clients } = await query;

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        <Link
          href="/clients/new"
          className="btn-primary px-4 py-2"
        >
          Add Client
        </Link>
      </div>

      <form className="mb-4">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search clients…"
          className="input w-full px-4 py-2.5"
        />
      </form>

      <div className="card overflow-hidden">
        <ul className="divide-y divide-white/[0.06]">
          {(clients ?? []).map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-white/[0.04]"
              >
                <span className="font-medium">
                  {c.first_name} {c.last_name}
                </span>
                <span className="text-zinc-400">{c.organization ?? c.email ?? c.cell_phone ?? ""}</span>
              </Link>
            </li>
          ))}
          {(clients ?? []).length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-zinc-400">No clients found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
