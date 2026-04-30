"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!confirm("Delete this trade?")) return;
    setBusy(true);
    const res = await fetch(`/api/trades/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/");
    else setBusy(false);
  }

  return (
    <button onClick={onClick} disabled={busy} className="btn-danger rounded-lg px-3 py-1.5 text-sm">
      {busy ? "…" : "Delete"}
    </button>
  );
}
