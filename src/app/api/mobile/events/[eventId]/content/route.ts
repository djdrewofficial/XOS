import { NextResponse } from "next/server";
import { UGC_ERRORS, isUuid } from "@/lib/ugcModeration";
import { listEventContent } from "@/lib/ugcModerationServer";

/* GET /api/mobile/events/:eventId/content
   Songs, likes, answers, notes, and the other member-visible fields.
   Hidden rows and blocked authors are omitted unless the caller is staff.
   Staff rows include hidden: true so removed content stays reviewable.

   Existing id fields are unchanged. Display fields are appended:
   songs.requestedByLabel, likes.displayName, likes.label,
   answers.answeredByLabel, sectionNotes.updatedByLabel,
   doNotPlayNotes.updatedByLabel, songIdeas.addedByLabel,
   coverPhoto.updatedByLabel, boothSelection.updatedByLabel,
   timelineFile.uploadedByLabel.
   A label is null when that row has no author id.
   people: { userId, displayName, label, role }[] for every author id in this payload.
   role is "host", "guest", "staff", or null when that person is no longer on this event.
   displayName is the event's stored first and last name, or null.
   label is unique in people and is the string to show. userId is the id to send
   to report, block, hide, or DELETE /guests/:userId.
   No phone, email, or auth metadata. A guest does not receive a staff personal name.
   Names are not taken from any other event. */

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return NextResponse.json({ error: UGC_ERRORS.eventNotFound }, { status: 404 });
  return listEventContent(req, eventId);
}
