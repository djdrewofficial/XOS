/** Machine payload that `restorePlannerValue` replays. Absent = not restorable. */
export type PlannerSnapshot =
  | { kind: "answer"; questionId: string; answer: string | null }
  | { kind: "song_row"; row: Record<string, unknown> }
  | { kind: "song_patch"; songId: string; patch: Record<string, unknown> }
  | { kind: "question_row"; question: Record<string, unknown>; answer: Record<string, unknown> | null }
  | { kind: "section_tree"; section: Record<string, unknown>; questions: Record<string, unknown>[]; answers: Record<string, unknown>[]; songs: Record<string, unknown>[] }
  | { kind: "section_patch"; sectionId: string; patch: Record<string, unknown> };

export type LibrarySectionOption = {
  id: string;
  title: string;
  icon: string | null;
  module: string | null;
  section_type: string;
  question_count: number;
};

export type BoothBackdrop = { id: string; name: string; image_url: string; category: string | null };

export type BoothDesign = {
  src: string;
  post_url: string | null;
  layout_size: string | null;
  image_type: string | null;
  no_of_images: string | null;
  type: string | null;
  type_name: string | null;
  video_url?: string | null;
  poster?: string | null;
};

export type BoothSelection = {
  backdrop_id: string | null;
  design: BoothDesign | null;
  picked_by_name: string | null;
  updated_at: string | null;
} | null;
