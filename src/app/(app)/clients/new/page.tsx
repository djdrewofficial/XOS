import ClientForm from "@/components/ClientForm";
import { createClientRecord } from "../actions";

export default function NewClientPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="mb-5 text-2xl font-bold">Add Client</h1>
      <ClientForm action={createClientRecord} />
    </div>
  );
}
