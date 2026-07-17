-- Villa Toscana venue-partner setup: a dedicated journey, the welcome email +
-- SMS + venue-confirmation email, and a "Booked - Villa Toscana" helper that
-- fires all of it in one click. The templates ship ACTIVE (so the helper can
-- run) but the HELPER ships INACTIVE — nothing sends until staff review the copy
-- and switch the helper on. Everything is guarded by name so re-runs are no-ops.

do $mig$
declare
  v_status    uuid;
  v_agreement uuid;
  v_journey   uuid;
  v_welcome   uuid;
  v_sms       uuid;
  v_venue     uuid;
  v_embed     text := '<iframe src="https://api.leadconnectorhq.com/widget/booking/cPllfYSeHEB1DRTsraIK" style="width: 100%;border:none;overflow: hidden;" scrolling="no" id="cPllfYSeHEB1DRTsraIK_1784306266630"></iframe><br><script src="https://link.msgsndr.com/js/form_embed.js" type="text/javascript"></script>';
begin
  select id into v_status from event_statuses where name = 'Booked EV' limit 1;
  select id into v_agreement from document_templates where name = 'Venue Partner Agreement' limit 1;

  -- 1) Journey -------------------------------------------------------------
  select id into v_journey from journey_types where name = 'Villa Toscana';
  if v_journey is null then
    insert into journey_types
      (name, description, is_default, step_confirm_info, step_sign_agreement, step_payment,
       step_app_onboarding, step_book_meeting, step_planner, agreement_template_id, calendar_embed,
       final_page_heading, final_page_body, sort_order)
    values
      ('Villa Toscana',
       'Clients booked through Villa Toscana. No payment to us — confirm info, sign the venue agreement, book the onboarding call, then download the app.',
       false, true, true, false, true, true, true, v_agreement, v_embed,
       'You''re all set!',
       'First, book your Exclusive Venue Onboarding call below. Then download the Xpress app and sign in with the login details we emailed you — that''s where you''ll plan your event.',
       20)
    returning id into v_journey;
  end if;

  -- 2) Welcome email (to the client) --------------------------------------
  select id into v_welcome from email_templates where name = 'Villa Toscana — Welcome';
  if v_welcome is null then
    insert into email_templates (name, group_name, subject, body_html, is_active, is_sms)
    values ('Villa Toscana — Welcome', 'BOOKED',
      'You''re booked at Villa Toscana! 🎉',
      $b$<p>Hi <first_name>,</p>
<p>Great news — your entertainment for your event at <strong>Villa Toscana</strong> on <event_date_long> is officially booked with Xpress Entertainment! 🎉</p>
<p>Because you're booking through Villa Toscana, there's nothing to pay us — the venue takes care of that. To get everything set for your big day, just tap the button below. It only takes a few minutes:</p>
<ul>
<li>✅ Confirm your details</li>
<li>✍️ Sign a quick agreement</li>
<li>📅 Book your onboarding call</li>
<li>📲 Download our app to start planning your music &amp; timeline</li>
</ul>
<journey_start_button>
<p>We can't wait to celebrate with you!</p>
<p>— The Xpress Entertainment Team</p>$b$,
      true, false)
    returning id into v_welcome;
  end if;

  -- 3) Welcome SMS (to the client) ----------------------------------------
  select id into v_sms from email_templates where name = 'Villa Toscana — Welcome SMS';
  if v_sms is null then
    insert into email_templates (name, group_name, subject, body_html, is_active, is_sms)
    values ('Villa Toscana — Welcome SMS', 'BOOKED', '',
      $b$Hi <first_name>! 🎉 You're booked with Xpress Entertainment for your event at Villa Toscana on <event_date_long>. Check your email to confirm your details and get started — talk soon!$b$,
      true, true)
    returning id into v_sms;
  end if;

  -- 4) Venue confirmation email (to Villa Toscana) ------------------------
  select id into v_venue from email_templates where name = 'Villa Toscana — Venue Confirmation';
  if v_venue is null then
    insert into email_templates (name, group_name, subject, body_html, is_active, is_sms)
    values ('Villa Toscana — Venue Confirmation', 'VENDORS',
      'Xpress Entertainment confirmed for <client_name> — <event_date_long>',
      $b$<p>Hi Kevin,</p>
<p>Confirming that <strong>Xpress Entertainment</strong> is booked to provide entertainment for your client's event at <strong>Villa Toscana</strong>:</p>
<ul>
<li><strong>Client:</strong> <client_name></li>
<li><strong>Event date:</strong> <event_date_long></li>
<li><strong>Event type:</strong> <event_type></li>
<li><strong>Time:</strong> <start_time> – <end_time></li>
</ul>
<p>We've reached out to the client to begin their planning. If anything about the event order changes, just let us know.</p>
<p>Thank you for having us!</p>
<p>— The Xpress Entertainment Team</p>$b$,
      true, false)
    returning id into v_venue;
  end if;

  -- 5) Booking helper (ships OFF) -----------------------------------------
  if not exists (select 1 from booking_helpers where title = 'Booked - Villa Toscana') then
    insert into booking_helpers (title, description, button_text, button_bg, button_fg, is_active, actions)
    values (
      'Booked - Villa Toscana',
      'One click for a Villa Toscana booking: sets status to Booked EV, starts the Villa Toscana journey, emails + texts the client their welcome, and emails Villa Toscana a confirmation.',
      'Booked - Villa', '#7c3aed', '#ffffff',
      false,
      jsonb_build_array(
        jsonb_build_object('type','set_status','status_id', v_status::text),
        jsonb_build_object('type','start_journey','journey_type_id', v_journey::text),
        jsonb_build_object('type','send_email','to','client','from','company','template_id', v_welcome::text),
        jsonb_build_object('type','send_sms','to','client','template_id', v_sms::text),
        jsonb_build_object('type','send_email','to','custom','address','hello@villa-toscana-miami.com','template_id', v_venue::text)
      )
    );
  end if;
end $mig$;
