export type ResolvedCandidate = {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
};

export type ResolvedSong = {
  songId: string;
  originalTitle: string;
  originalArtist: string | null;
  provider: string;
  candidate: ResolvedCandidate | null;
  confidence: "high" | "review"; // high = came from Spotify already; review = matched by search/AI
};

export type ResolvedSection = { sectionId: string; title: string; songs: ResolvedSong[] };

export type SpotifyExportResult = { section: string; url?: string; added?: number; error?: string };
