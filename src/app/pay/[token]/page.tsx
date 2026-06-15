import { redirect } from "next/navigation";

/* /pay is the canonical short link; the full experience lives at /welcome. */
export default async function PayRedirect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/welcome/${token}`);
}
