"use client";

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-primary px-5 py-2 text-sm">
      🖨 Print / Save as PDF
    </button>
  );
}
