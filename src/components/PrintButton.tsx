"use client";

export default function PrintButton({
  label = "🖨 Print / Save as PDF",
  className = "btn-primary px-5 py-2 text-sm",
}: {
  label?: string;
  className?: string;
}) {
  // print:hidden — the button itself never appears in the PDF/print output
  return (
    <button onClick={() => window.print()} className={`print:hidden ${className}`}>
      {label}
    </button>
  );
}
