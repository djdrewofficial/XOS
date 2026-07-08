"use client";

/* Delete button for the email-template editor. Lives inside the page's main
   <form> (which saves via updateTemplate), so it overrides the target with
   formAction and skips field validation with formNoValidate. Confirms first. */
export default function DeleteTemplateButton({
  action,
  name,
}: {
  action: (formData: FormData) => void | Promise<void>;
  name: string;
}) {
  return (
    <div className="px-4 py-3.5">
      <button
        type="submit"
        formAction={action}
        formNoValidate
        onClick={(e) => {
          if (!window.confirm(`Delete "${name}"? It will be removed from your active templates.`)) {
            e.preventDefault();
          }
        }}
        className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
      >
        Delete Template
      </button>
    </div>
  );
}
