export default function PhotoGallery({
  photos,
  upload,
  remove,
}: {
  photos: { id: string; path: string; url: string }[];
  upload: (formData: FormData) => Promise<void>;
  remove: (photoId: string, path: string) => Promise<void>;
}) {
  return (
    <div className="card p-5">
      <h2 className="card-title">Photos</h2>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <div key={p.id} className="group relative overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="equipment" className="h-28 w-full object-cover" />
            <form action={remove.bind(null, p.id, p.path)} className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button className="rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white hover:bg-red-600">✕</button>
            </form>
          </div>
        ))}
        {photos.length === 0 && (
          <p className="col-span-3 text-sm text-zinc-500">No photos yet — add one so crew knows what this looks like.</p>
        )}
      </div>
      <form action={upload} className="flex items-center gap-2">
        <input
          type="file"
          name="photo"
          accept="image/*"
          required
          className="block w-full text-xs text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-brand file:to-brand-light file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:brightness-110"
        />
        <button className="btn-ghost px-4 py-1.5 text-xs">Upload</button>
      </form>
    </div>
  );
}
