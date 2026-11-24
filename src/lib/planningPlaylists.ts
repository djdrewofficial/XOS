/* Playlist moments — pure helpers for the couple Music tab.
   A playlist moment is a planning section with is_playlist=true. Its songs
   live in planning_songs (section_id + sort_order). Safe for unit tests. */

export type PlaylistSongInput = {
  id: string;
  sectionId: string;
  title: string;
  artist: string | null;
  note?: string | null;
  externalUrl?: string | null;
  requestedBy?: string | null;
  mustPlay?: boolean;
  doNotPlay?: boolean;
  sortOrder: number;
  likeCount?: number;
  likedByMe?: boolean;
  hidden?: boolean;
};

export type PlaylistSectionInput = {
  id: string;
  title: string;
  isPlaylist: boolean;
  songLimit?: number | null;
  guestEnabled?: boolean;
  deletedByHost?: boolean;
  sortOrder?: number;
};

export type MobilePlaylistSong = {
  id: string;
  title: string;
  artist: string | null;
  note: string | null;
  externalUrl: string | null;
  requestedBy: string | null;
  mustPlay: boolean;
  doNotPlay: boolean;
  sortOrder: number;
  likeCount: number;
  likedByMe: boolean;
  hidden?: boolean;
};

export type MobilePlaylist = {
  sectionId: string;
  title: string;
  songLimit: number | null;
  songs: MobilePlaylistSong[];
};

/** Wedding 2026 titles marked as playlist moments in migration 00241. */
export const WEDDING_2026_PLAYLIST_TITLES = [
  "Ceremony Prelude (Guest Arrival)",
  "Cocktail Vibes",
  "Dinner Music",
  "Dance Floor Suggestions",
] as const;

export const WEDDING_2026_TEMPLATE_ID = "a1c50a27-3fd5-4f4f-95b2-b7ee2d1e7dd7";

/** True when a section title is a clear multi-song playlist moment (heuristic for docs/tests). */
export function titleLooksLikePlaylistMoment(title: string): boolean {
  const t = title.toLowerCase().trim();
  if (!t) return false;
  if (/don'?t play|do not play|must play|slow dance/.test(t)) return false;
  if (/prelude|pre-?ceremony|guest arrival|seating music/.test(t)) return true;
  if (/cocktail/.test(t)) return true;
  if (/dinner/.test(t) && /music|playlist|vibes?/.test(t)) return true;
  if (/^dinner music$/.test(t)) return true;
  if (/dance floor|open dancing|party playlist/.test(t)) return true;
  return false;
}

/**
 * Build the Music-tab playlist list from sections + flat songs.
 * Guests only see guest-enabled playlists. Host-deleted sections are omitted.
 * Songs are ordered by sortOrder within each playlist.
 */
export function buildPlaylists(opts: {
  sections: PlaylistSectionInput[];
  songs: PlaylistSongInput[];
  role?: "staff" | "host" | "guest";
}): MobilePlaylist[] {
  const role = opts.role ?? "host";
  const bySection = new Map<string, PlaylistSongInput[]>();
  for (const song of opts.songs) {
    const list = bySection.get(song.sectionId) ?? [];
    list.push(song);
    bySection.set(song.sectionId, list);
  }

  return opts.sections
    .filter((s) => s.isPlaylist && !s.deletedByHost)
    .filter((s) => role !== "guest" || s.guestEnabled !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((s) => {
      const songs = (bySection.get(s.id) ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(
          (song): MobilePlaylistSong => ({
            id: song.id,
            title: song.title,
            artist: song.artist,
            note: song.note ?? null,
            externalUrl: song.externalUrl ?? null,
            requestedBy: song.requestedBy ?? null,
            mustPlay: Boolean(song.mustPlay),
            doNotPlay: Boolean(song.doNotPlay),
            sortOrder: song.sortOrder,
            likeCount: song.likeCount ?? 0,
            likedByMe: Boolean(song.likedByMe),
            ...(song.hidden != null ? { hidden: song.hidden } : {}),
          }),
        );
      return {
        sectionId: s.id,
        title: s.title,
        songLimit: s.songLimit ?? null,
        songs,
      };
    });
}
