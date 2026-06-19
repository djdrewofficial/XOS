-- XOS — wire the Corporate Event Services Agreement's bracket placeholders to
-- real merge tags. Adds the data fields the contract needs that didn't exist
-- yet, extends render_merge_tags (v6), and swaps the literal [BRACKETS] in the
-- template blocks for HTML-escaped &lt;tags&gt; (so Tiptap preserves them).
--
-- New fields:
--   clients.authorized_rep_{name,title,email,phone}  — the person who signs &
--     binds the company (client-level: the signer is stable across a corporate
--     client's events).
--   events.decision_maker_{name,phone,email}         — on-site approver for THIS
--     event's changes/overtime (event-level: varies per event).
--   company_settings.legal_venue                      — legal jurisdiction for the
--     governing-law clause (e.g. "Broward County, Florida").
--
-- Left as static policy constants (not tagged): [14–30] COI days, [12] months
-- (reschedule / non-solicit), and Exhibit B's [NUMBER] hours load-in lead time.
-- Money/payment placeholders stay in the fee_table / payment_schedule smart blocks.

-- ============ NEW DATA FIELDS ============
alter table clients
  add column if not exists authorized_rep_name text,
  add column if not exists authorized_rep_title text,
  add column if not exists authorized_rep_email text,
  add column if not exists authorized_rep_phone text;

alter table events
  add column if not exists decision_maker_name text,
  add column if not exists decision_maker_phone text,
  add column if not exists decision_maker_email text;

alter table company_settings
  add column if not exists legal_venue text;

-- ============ MERGE TAGS v6 ============
-- + authorized representative (name/title/email/phone), client address/org
-- + decision-maker (name/phone/email), venue address, setup time, guest count
-- + billing terms (readable), legal venue (jurisdiction, fallback Broward County)
create or replace function render_merge_tags(p_event_id uuid, p_template text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  c record;
  v record;
  p record;
  cs record;
  sp record;
  out_text text := coalesce(p_template, '');
  v_total numeric := 0;
  v_paid numeric := 0;
  v_addons numeric := 0;
  v_countdown int;
  v_overtime numeric := 0;
  v_venue_addr text;
  v_billing_terms text;
begin
  -- decode escaped angle brackets so <merge_tags> from the HTML editor match
  out_text := replace(out_text, '&lt;', '<');
  out_text := replace(out_text, '&gt;', '>');

  select * into e from events where id = p_event_id;
  if not found then return out_text; end if;

  select * into c from clients where id = e.client_id;
  select * into v from venues where id = e.venue_id;
  select * into p from packages where id = e.package_id;
  select * into cs from company_settings where id = true;
  select * into sp from scheduled_payments where event_id = e.id order by seq limit 1;

  select coalesce(sum(quantity * coalesce(ea.price_override, ea.price_locked, a.default_price)), 0)
    into v_addons
  from event_addons ea join addons a on a.id = ea.addon_id
  where ea.event_id = e.id;

  v_total := coalesce(e.package_price_override, e.package_price_locked, p.default_price, 0)
             + v_addons + e.overtime_fee + e.travel_fee
             + coalesce(v.setup_fee, 0)
             - e.discount1_amount - e.discount2_amount;

  select coalesce(sum(amount), 0) into v_paid from payments where event_id = e.id;

  v_countdown := case when e.event_date is null then null
                 else (e.event_date - current_date) end;

  -- overtime $/hr from the pinned package version (falls back to the live package)
  v_overtime := coalesce(
    (select (pv.snapshot->>'overtime_hourly')::numeric
       from package_versions pv
      where pv.package_id = e.package_id and pv.version_no = e.package_version_no),
    p.overtime_hourly, 0);

  -- single-line venue address: "Street, City, State Zip" (skips blank parts)
  v_venue_addr := concat_ws(', ',
    nullif(v.address, ''),
    nullif(v.city, ''),
    nullif(trim(concat_ws(' ', nullif(v.state, ''), nullif(v.zip, ''))), ''));

  -- billing terms code → human-readable label for the agreement
  v_billing_terms := case e.billing_terms
    when 'up_front' then 'Due Up Front'
    when 'net_30' then 'Net 30'
    when 'installments' then 'Installments'
    else coalesce(e.billing_terms, 'None') end;

  out_text := replace(out_text, '<first_name>', coalesce(c.first_name, ''));
  out_text := replace(out_text, '<last_name>', coalesce(c.last_name, ''));
  out_text := replace(out_text, '<client_name>', trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')));
  out_text := replace(out_text, '<client_email>', coalesce(c.email, ''));
  out_text := replace(out_text, '<client_cell>', coalesce(c.cell_phone, ''));
  out_text := replace(out_text, '<client_organization>', coalesce(c.organization, ''));
  out_text := replace(out_text, '<client_address>', coalesce(c.mailing_address, ''));
  out_text := replace(out_text, '<authorized_rep_name>', coalesce(c.authorized_rep_name, ''));
  out_text := replace(out_text, '<authorized_rep_title>', coalesce(c.authorized_rep_title, ''));
  out_text := replace(out_text, '<authorized_rep_email>', coalesce(c.authorized_rep_email, ''));
  out_text := replace(out_text, '<authorized_rep_phone>', coalesce(c.authorized_rep_phone, ''));
  out_text := replace(out_text, '<event_name>', coalesce(e.name, ''));
  out_text := replace(out_text, '<event_type>',
    coalesce((select name from event_types where id = e.event_type_id), ''));
  out_text := replace(out_text, '<event_date_long>',
    coalesce(to_char(e.event_date, 'FMDay, FMMonth FMDD, YYYY'), ''));
  out_text := replace(out_text, '<event_date_short>',
    coalesce(to_char(e.event_date, 'MM/DD/YYYY'), ''));
  out_text := replace(out_text, '<event_date_countdown>', coalesce(v_countdown::text, ''));
  out_text := replace(out_text, '<venue_name>', coalesce(v.name, ''));
  out_text := replace(out_text, '<venue_address>', coalesce(v_venue_addr, ''));
  out_text := replace(out_text, '<package_name>', coalesce(p.name, ''));
  out_text := replace(out_text, '<setup_time>', coalesce(to_char(e.setup_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<guest_count>', coalesce(e.guest_count::text, ''));
  out_text := replace(out_text, '<decision_maker_name>', coalesce(e.decision_maker_name, ''));
  out_text := replace(out_text, '<decision_maker_phone>', coalesce(e.decision_maker_phone, ''));
  out_text := replace(out_text, '<decision_maker_email>', coalesce(e.decision_maker_email, ''));
  out_text := replace(out_text, '<billing_terms>', v_billing_terms);
  out_text := replace(out_text, '<total_fee>', to_char(v_total, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<payments_received>', to_char(v_paid, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<balance_due>', to_char(v_total - v_paid, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<deposit_value>', to_char(e.deposit_value, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<retainer_amount>',
    to_char(coalesce(sp.amount, e.deposit_value, 0), 'FM$999,999,990.00'));
  out_text := replace(out_text, '<retainer_due_date>',
    coalesce(to_char(sp.due_date, 'FMMonth FMDD, YYYY'), 'upon signing'));
  out_text := replace(out_text, '<overtime_rate>', to_char(v_overtime, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<start_time>', coalesce(to_char(e.start_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<end_time>', coalesce(to_char(e.end_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<company_name>', coalesce(cs.company_name, 'Xpress Entertainment'));
  out_text := replace(out_text, '<company_email_signature>', coalesce(cs.email_signature_html, ''));
  out_text := replace(out_text, '<email_signature>', coalesce(cs.email_signature_html, ''));
  out_text := replace(out_text, '<legal_venue>', coalesce(nullif(cs.legal_venue, ''), 'Broward County, Florida'));
  out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));

  return out_text;
end;
$$;

grant execute on function render_merge_tags(uuid, text) to authenticated;

-- ============ TEMPLATE BLOCKS: replace literal [BRACKETS] with &lt;tags&gt; ============
update document_templates
set blocks = $blocks$[
  {"id":"intro","type":"text","html":"<p>This Corporate Event Services Agreement (“Agreement”) is entered into by and between <strong>Xpress Entertainment</strong> (“Xpress,” “Company,” “we,” “us,” or “our”) and the client identified below (“Client,” “you,” or “your”).</p><p>This Agreement is intended for corporate, brand, nonprofit, venue, private company, and business-related events.</p>"},
  {"id":"s1","type":"section","title":"1. Client Information","html":"<p><strong>Client / Company Name:</strong> &lt;client_name&gt;<br><strong>Authorized Representative:</strong> &lt;authorized_rep_name&gt;<br><strong>Title / Role:</strong> &lt;authorized_rep_title&gt;<br><strong>Email:</strong> &lt;authorized_rep_email&gt;<br><strong>Phone:</strong> &lt;authorized_rep_phone&gt;<br><strong>Billing Address:</strong> &lt;client_address&gt;</p><p>The individual signing this Agreement represents that they have authority to bind the Client, company, organization, brand, venue, sponsor, or entity listed above.</p>"},
  {"id":"s2","type":"section","title":"2. Event Information","html":"<p><strong>Event Name / Description:</strong> &lt;event_name&gt;<br><strong>Event Date:</strong> &lt;event_date_long&gt;<br><strong>Venue / Location:</strong> &lt;venue_name&gt; — &lt;venue_address&gt;<br><strong>Event Start Time:</strong> &lt;start_time&gt;<br><strong>Event End Time:</strong> &lt;end_time&gt;<br><strong>Vendor Arrival / Load-In Time:</strong> &lt;setup_time&gt;<br><strong>Performance / Service Time:</strong> &lt;start_time&gt; – &lt;end_time&gt;<br><strong>Estimated Guest Count:</strong> &lt;guest_count&gt;<br><strong>Event Type:</strong> &lt;event_type&gt;</p><p>The final event timeline, services, production needs, payment schedule, and any additional terms shall be listed in the attached event terms, proposal, invoice, or service schedule, which are incorporated into this Agreement.</p>"},
  {"id":"s3","type":"section","title":"3. Services Provided","html":"<p>Xpress Entertainment agrees to provide the entertainment, production, and/or event services listed in the attached proposal, invoice, service package, or event schedule.</p><p>Services may include, depending on the selected package:</p><ul><li>DJ services</li><li>MC / hosting services</li><li>Sound system</li><li>Microphones</li><li>Lighting</li><li>Photo booth services</li><li>Content capture</li><li>Live musicians</li><li>Cold sparks</li><li>Dancing on the clouds</li><li>CO2 effects</li><li>Lasers</li><li>Uplighting</li><li>Monogram / logo projection</li><li>Club-style lighting</li><li>Other production or entertainment services listed in writing</li></ul><p>Only the services specifically listed in writing are included. Any service, equipment, staffing, setup, room, location, time extension, or production request not listed in writing is not included unless approved by Xpress and added by written change order.</p>"},
  {"id":"s4","type":"section","title":"4. Payment Terms","html":"<p>The total fee, payment schedule, deposit/retainer amount, balance due date, and any approved corporate invoicing terms shall be listed in the attached payment schedule, proposal, invoice, or event terms.</p><p>Unless otherwise stated in writing:</p><ol><li>The event date is not reserved until this Agreement is signed and the required initial payment, retainer, deposit, or first scheduled payment is received.</li><li>Client is responsible for making payments according to the agreed payment schedule.</li><li>Any late, missing, declined, disputed, reversed, or unpaid payment may result in suspension of planning, production, staffing, or services until the account is brought current.</li><li>Any approved corporate payment terms, including invoicing, purchase orders, Net 15, Net 30, or other billing arrangements, must be approved by Xpress in writing before the event.</li><li>A purchase order or internal billing document from Client shall not modify this Agreement unless Xpress agrees to the modification in writing.</li><li>Client is responsible for any bank fees, chargeback fees, processing fees, collection costs, or returned payment fees caused by Client’s payment method.</li></ol><p>Any applicable taxes, venue fees, permit fees, union labor fees, parking fees, valet fees, power fees, fire watch fees, special effect permit fees, security charges, or required third-party costs are the responsibility of Client unless specifically included in writing by Xpress.</p>"},
  {"id":"s5","type":"section","title":"5. Authorized Decision-Maker","html":"<p>Client shall identify one primary authorized decision-maker for the event.</p><p><strong>Authorized Decision-Maker:</strong> &lt;decision_maker_name&gt;<br><strong>Phone:</strong> &lt;decision_maker_phone&gt;<br><strong>Email:</strong> &lt;decision_maker_email&gt;</p><p>Only the Authorized Decision-Maker may approve changes to:</p><ul><li>Event timeline</li><li>Service times</li><li>Overtime</li><li>Add-ons</li><li>Room changes</li><li>Equipment changes</li><li>Special effects</li><li>Production changes</li><li>Additional staffing</li><li>Additional charges</li><li>Media restrictions</li><li>Branding approvals</li></ul><p>On-site approvals may be accepted by text message, email, verbal approval, signed change order, or other reasonable written confirmation from the Authorized Decision-Maker. Client agrees to pay for all approved changes, overtime, additions, or expenses.</p>"},
  {"id":"s6","type":"section","title":"6. Production Requirements, Venue Access, Parking, Power, and Load-In","html":"<p>Production requirements depend on the selected event package, venue, event layout, guest count, and services being provided.</p><p>Client is responsible for providing, at Client’s expense unless otherwise stated in writing:</p><ol><li>Safe and reasonable access to the venue and event space.</li><li>Vendor parking, loading area, loading dock access, valet clearance, or parking reimbursement.</li><li>Elevator access, freight elevator access, ramp access, or reasonable load-in path where needed.</li><li>Adequate setup time and teardown time.</li><li>Adequate space for equipment, DJ booth, photo booth, lighting, special effects, musicians, or other contracted services.</li><li>Stable and adequate power within a reasonable distance of the setup area.</li><li>Any required power drops, generator, electrician, union labor, venue engineer, cable ramps, lift equipment, staging, trussing, rigging, pipe and drape, internet access, or additional production support.</li><li>A safe and weather-protected performance and equipment area.</li><li>Any required venue approval, fire marshal approval, permit, inspection, fire watch, security, or special effect clearance.</li><li>Any parking, tolls, valet, loading dock, garage, hotel, resort, union, venue, or access fees charged to Xpress Entertainment or its team.</li></ol><p>Unless otherwise specified in writing, parking, loading access, and power must be provided by Client or reimbursed to Xpress Entertainment.</p><p>Xpress is not responsible for delays, reduced setup, modified production, incomplete setup, or inability to provide certain services caused by lack of access, parking restrictions, power limitations, venue rules, unsafe conditions, late room access, freight elevator delays, security restrictions, vendor scheduling conflicts, or missing venue approvals.</p>"},
  {"id":"s7","type":"section","title":"7. Certificate of Insurance / COI","html":"<p>Xpress Entertainment may provide a Certificate of Insurance upon request, subject to policy terms, insurance carrier approval, and reasonable advance notice.</p><p>Client must provide any insurance requirements in writing at least [14–30] days before the event, including:</p><ul><li>Certificate holder name</li><li>Additional insured wording, if required</li><li>Venue name and address</li><li>Required coverage limits</li><li>Required endorsements</li><li>Deadline for submission</li><li>Contact information for the venue, planner, risk manager, or event contact</li></ul><p>If the venue, property owner, city, county, Client, or third party requires additional insured status, special wording, waivers, endorsements, increased limits, or insurance documents outside of Xpress Entertainment’s standard policy, Client is responsible for any additional cost, processing fee, premium, administrative fee, or delay.</p><p>Xpress Entertainment is not responsible for a venue’s refusal to accept insurance documentation if the requirement was not provided to Xpress in a timely manner or requires coverage outside of Xpress Entertainment’s available policy.</p>"},
  {"id":"s8","type":"section","title":"8. Client Responsibilities","html":"<p>Client is responsible for:</p><ol><li>Providing accurate event information.</li><li>Communicating all venue rules, restrictions, insurance requirements, load-in instructions, parking instructions, power limitations, and special requirements in advance.</li><li>Securing all venue permissions and approvals necessary for Xpress to perform.</li><li>Ensuring the venue allows the selected services and effects.</li><li>Providing a safe working environment for Xpress staff, performers, technicians, and subcontractors.</li><li>Ensuring guests, employees, contractors, sponsors, and attendees do not interfere with, damage, move, misuse, or obstruct Xpress equipment.</li><li>Paying for any damage, loss, theft, or cleaning caused by Client, venue, guests, employees, sponsors, attendees, or third parties.</li><li>Providing required logos, brand assets, run-of-show documents, music preferences, announcements, scripts, or presentation materials by the requested deadline.</li><li>Ensuring all content, logos, music, images, video, trademarks, and branding materials provided to Xpress are legally authorized for use at the event.</li></ol>"},
  {"id":"s9","type":"section","title":"9. Scope Changes, Add-Ons, and Change Orders","html":"<p>The contracted services are limited to the package, proposal, invoice, and written terms approved by both parties.</p><p>Additional charges may apply for:</p><ul><li>Earlier load-in</li><li>Extended event time</li><li>Overtime</li><li>Additional rooms or areas</li><li>Additional sound systems</li><li>Additional microphones</li><li>Additional lighting</li><li>Photo booth extension</li><li>Additional attendants</li><li>Special effects</li><li>Custom branding</li><li>Additional content capture</li><li>Additional musicians</li><li>Extra setup locations</li><li>Difficult load-in</li><li>Stairs or long-distance load-in</li><li>Venue-mandated labor</li><li>Power changes</li><li>Outdoor setup changes</li><li>Timeline changes requiring additional staffing</li><li>Event relocation or room flip needs</li><li>Any service not originally included in writing</li></ul><p>Xpress may require written approval and payment before providing additional services. When changes are requested on-site, the Authorized Decision-Maker may approve the change by text, email, verbal confirmation, or written authorization. Client agrees to pay all approved charges.</p>"},
  {"id":"s10","type":"section","title":"10. Overtime","html":"<p>Overtime is not guaranteed and is subject to staff availability, venue approval, and equipment availability.</p><p>If Client requests overtime and Xpress agrees to provide it, Client agrees to pay the overtime rate listed in the attached terms or, if no overtime rate is listed, the standard Xpress Entertainment overtime rate for the service provided.</p><p>Overtime may be billed after the event and is due upon receipt unless otherwise agreed in writing.</p>"},
  {"id":"s11","type":"section","title":"11. Branding, Logos, and Client Materials","html":"<p>If Client requests use of logos, brand assets, branded visuals, sponsor materials, custom monograms, digital graphics, signage, photo booth templates, announcements, or branded content, Client must provide all required assets by the deadline requested by Xpress.</p><p>Client grants Xpress a limited right to use Client-provided logos, names, trademarks, images, videos, and brand assets only as reasonably necessary to perform the services for the event.</p><p>Client represents that it has the legal right to provide and authorize use of all materials given to Xpress. Client shall be responsible for any claim, dispute, copyright issue, trademark issue, licensing issue, or third-party demand related to materials supplied by Client.</p><p>Xpress is not responsible for spelling errors, outdated logos, incorrect brand colors, low-resolution files, missing files, or delayed branding materials supplied by Client.</p>"},
  {"id":"s12","type":"section","title":"12. Photos, Video, Recording, and Media Usage","html":"<p>Xpress Entertainment may capture photos, video, audio, behind-the-scenes footage, crowd reactions, setup footage, performance clips, and selected event moments for internal records, portfolio use, social media, marketing, website, advertising, and promotional purposes.</p><p>Xpress will not intentionally disclose confidential business information, private internal presentations, unreleased products, trade secrets, sensitive employee information, or restricted materials.</p><p>Client may opt out of media usage by notifying Xpress in writing before the event. Any media restrictions must be provided in writing before the event and must clearly state what cannot be recorded, posted, tagged, named, or used.</p><p>Unless Client provides written restrictions before the event, Client grants Xpress permission to record and post selected non-confidential aspects of the event.</p><p>Client is responsible for notifying Xpress of any privacy restrictions, VIP restrictions, sponsor restrictions, employee restrictions, venue restrictions, or brand guidelines related to recording or posting.</p>"},
  {"id":"s13","type":"section","title":"13. Confidentiality","html":"<p>Each party may receive confidential or private information related to the event, business operations, employees, guests, sponsors, vendors, clients, pricing, planning, production, marketing, or internal materials.</p><p>Both parties agree to use reasonable care to protect confidential information and not disclose it to third parties except as necessary to perform the event, comply with law, comply with insurance or venue requirements, or enforce this Agreement.</p><p>Confidential information does not include information that:</p><ol><li>Is publicly available through no fault of the receiving party.</li><li>Was already known before disclosure.</li><li>Is independently developed without using the other party’s confidential information.</li><li>Must be disclosed by law, subpoena, court order, insurance requirement, or governmental authority.</li></ol><p>This confidentiality obligation survives the event.</p>"},
  {"id":"s14","type":"section","title":"14. Safety, Venue Rules, Permits, and Compliance","html":"<p>Client acknowledges that entertainment, sound, lighting, photo booths, staging, electrical equipment, cables, special effects, CO2, cold sparks, lasers, and production equipment may require venue approval, safe operating conditions, proper clearances, permits, fire marshal approval, security coordination, fire watch, or compliance with applicable laws, rules, codes, and venue requirements.</p><p>Xpress Entertainment reserves the right to refuse, stop, modify, delay, or discontinue any service, effect, setup, or performance if Xpress determines, in its reasonable judgment, that:</p><ol><li>Conditions are unsafe.</li><li>Required approvals are missing.</li><li>Required permits are missing.</li><li>Power is unsafe or inadequate.</li><li>Weather creates a risk to people or equipment.</li><li>Venue rules prohibit the service.</li><li>The service may violate applicable law, fire code, safety rule, or insurance requirement.</li><li>Guests or attendees are too close to equipment or effects.</li><li>Staff, performers, guests, or equipment are at risk.</li><li>Client, venue, guests, employees, attendees, or third parties interfere with safe operation.</li></ol><p>Xpress is not responsible for failure to provide or complete any service that is restricted, denied, interrupted, or prohibited by a venue, fire marshal, law enforcement, governmental authority, weather, safety concern, missing permit, missing approval, missing power, or unsafe condition.</p><p>Client remains responsible for all contracted fees even if a service must be modified or discontinued due to circumstances outside Xpress Entertainment’s control.</p>"},
  {"id":"s15","type":"section","title":"15. Special Effects and Enhanced Production","html":"<p>Special effects and enhanced production may include cold sparks, dancing on the clouds, CO2 guns, CO2 cannons, lasers, haze, fog, confetti, lighting effects, monograms, uplighting, club-style lighting, or other specialty services.</p><p>All special effects are subject to:</p><ul><li>Venue approval</li><li>Local laws and codes</li><li>Fire marshal approval, if required</li><li>Permit approval, if required</li><li>Weather conditions</li><li>Ceiling height</li><li>Floor material</li><li>Airflow and ventilation</li><li>Fire alarm and sprinkler systems</li><li>Guest proximity</li><li>Safe clearance</li><li>Power availability</li><li>Staff availability</li><li>Equipment availability</li><li>Insurance restrictions</li><li>Manufacturer and operator safety requirements</li></ul><p>Cold sparks require appropriate venue approval, ceiling height, clearance, safe operating area, and permission from the venue and/or authority having jurisdiction when required. Xpress may refuse to operate cold sparks if the venue, room, ceiling, floor, crowd placement, or other conditions are not safe or approved.</p><p>CO2 effects require venue approval and safe crowd placement. Xpress may refuse to operate CO2 effects if the area is unsafe, too crowded, restricted by the venue, or otherwise unsuitable.</p><p>Lasers, where applicable, must be operated in a safe and compliant manner. Xpress may refuse or modify laser use if the equipment, venue, crowd placement, outdoor exposure, aircraft risk, line-of-sight, regulatory requirements, or operating conditions make laser use unsuitable.</p><p>Client is responsible for obtaining and paying for all venue approvals, permits, fire watch, fire marshal fees, inspections, special effect approvals, or related requirements unless otherwise agreed in writing.</p><p>No refund shall be due for special effects or production services that cannot be performed because Client or venue failed to obtain required approvals, permits, access, power, clearances, or safe conditions.</p>"},
  {"id":"s16","type":"section","title":"16. Outdoor Events and Weather","html":"<p>For outdoor events, Client must provide a safe, covered, dry, level, and weather-protected setup area for Xpress staff and equipment.</p><p>Client must provide an acceptable weather backup plan for rain, wind, lightning, extreme heat, extreme cold, flooding, unsafe ground conditions, or other outdoor risks.</p><p>Xpress reserves the right to stop, pause, delay, relocate, or refuse setup or performance if weather or outdoor conditions create a risk to people, equipment, or safe performance.</p><p>Client remains responsible for all contracted fees if services are delayed, modified, relocated, shortened, or stopped due to weather, lack of cover, unsafe outdoor conditions, or failure to provide an acceptable backup plan.</p>"},
  {"id":"s17","type":"section","title":"17. Equipment Safety and Damage","html":"<p>All equipment provided by Xpress remains the property of Xpress Entertainment or its vendors, subcontractors, or suppliers.</p><p>Client is responsible for damage, theft, loss, misuse, tampering, spilled drinks, guest interference, venue damage, employee interference, sponsor interference, or third-party damage to Xpress equipment during the event, setup, or teardown.</p><p>No person may move, touch, disconnect, operate, climb on, cover, block, decorate, or attach anything to Xpress equipment without permission from Xpress.</p><p>Client agrees to reimburse Xpress for repair, replacement, cleaning, rental, labor, rush replacement, or lost income costs related to damaged, stolen, or missing equipment caused by Client, venue, guests, employees, attendees, sponsors, contractors, or third parties.</p>"},
  {"id":"s18","type":"section","title":"18. Staff Safety, Harassment, and Conduct","html":"<p>Client agrees to provide a professional and safe working environment for Xpress staff, DJs, MCs, technicians, attendants, musicians, and subcontractors.</p><p>Xpress may pause, stop, or terminate services without refund if Xpress staff are subjected to unsafe conditions, threats, harassment, discrimination, assault, unwanted touching, aggressive behavior, intoxicated interference, equipment tampering, or any conduct that creates a risk to people, equipment, or the event.</p><p>Client is responsible for the conduct of Client’s employees, guests, attendees, sponsors, contractors, security, venue staff, and third parties.</p>"},
  {"id":"s19","type":"section","title":"19. Music, Announcements, and Program Content","html":"<p>Client is responsible for providing any required scripts, names, pronunciation notes, run-of-show documents, sponsor reads, award lists, company announcements, executive names, program details, or special instructions by the deadline requested by Xpress.</p><p>Xpress will make reasonable efforts to follow Client’s music preferences, program instructions, and timeline. However, Client understands that entertainment services involve professional judgment, crowd response, venue conditions, timing changes, and real-time adjustments.</p><p>Xpress does not guarantee specific crowd participation, dancing, audience behavior, employee participation, guest reaction, or event outcome.</p>"},
  {"id":"s20","type":"section","title":"20. Cancellation by Client","html":"<p>Cancellation terms shall be listed in the attached payment schedule, proposal, invoice, or event terms.</p><p>If no separate cancellation terms are listed, the following default terms apply:</p><ol><li>Initial retainers, deposits, and booking payments are non-refundable.</li><li>Cancellation more than 90 days before the event: Client forfeits payments already made.</li><li>Cancellation 31 to 90 days before the event: Client is responsible for 50% of the total contracted amount.</li><li>Cancellation 30 days or less before the event: Client is responsible for 100% of the total contracted amount.</li><li>Any custom items, special orders, subcontracted talent, permits, insurance costs, staffing costs, travel costs, design work, production work, or non-refundable third-party costs are due regardless of cancellation date.</li></ol><p>Cancellation must be submitted in writing by the Authorized Decision-Maker.</p>"},
  {"id":"s21","type":"section","title":"21. Rescheduling","html":"<p>Rescheduling is subject to Xpress Entertainment’s availability and must be approved in writing.</p><p>If Client requests to reschedule, Xpress may, at its discretion, apply payments already made toward a new date if the new date is available and the event is rescheduled within [12] months of the original date.</p><p>Additional fees may apply for:</p><ul><li>Date changes</li><li>Venue changes</li><li>Package changes</li><li>Staffing changes</li><li>Production changes</li><li>Travel changes</li><li>Increased costs</li><li>Third-party vendor changes</li><li>Short-notice rescheduling</li><li>Previously incurred costs</li></ul><p>If Xpress is unavailable for the new date, the reschedule may be treated as a cancellation.</p>"},
  {"id":"s22","type":"section","title":"22. Force Majeure","html":"<p>Neither party shall be liable for failure or delay in performance caused by events beyond that party’s reasonable control, including but not limited to acts of God, hurricanes, tropical storms, flooding, fire, natural disasters, war, terrorism, civil unrest, government orders, epidemic, pandemic, public health emergency, power failure, venue closure, road closure, transportation shutdown, labor strike, emergency, or other circumstances that make performance illegal, impossible, unsafe, or commercially impracticable.</p><p>If a force majeure event occurs, Xpress and Client shall make reasonable efforts to reschedule the event if possible.</p><p>Payments already made may be applied toward a mutually available rescheduled date, less any non-refundable costs, third-party costs, custom production costs, staffing costs, permit costs, travel costs, or expenses already incurred.</p><p>If the event cannot be rescheduled, Xpress shall have no obligation to refund amounts already earned, spent, committed, or incurred.</p>"},
  {"id":"s23","type":"section","title":"23. Limitation of Liability","html":"<p>To the fullest extent permitted by law, Xpress Entertainment shall not be liable for indirect, incidental, consequential, special, punitive, exemplary, or lost-profit damages arising from or related to this Agreement, the event, or the services provided.</p><p>Xpress Entertainment’s total liability for any claim arising from or related to this Agreement shall not exceed the total amount paid by Client to Xpress for the specific event giving rise to the claim.</p><p>This limitation does not apply where prohibited by law.</p>"},
  {"id":"s24","type":"section","title":"24. Indemnification","html":"<p>Client agrees to defend, indemnify, and hold harmless Xpress Entertainment, its owners, employees, contractors, DJs, MCs, technicians, attendants, musicians, vendors, agents, and representatives from and against any claims, damages, losses, liabilities, demands, costs, expenses, fines, penalties, or attorney’s fees arising from or related to:</p><ol><li>Client’s breach of this Agreement.</li><li>Client’s event, guests, employees, attendees, sponsors, vendors, venue, contractors, or representatives.</li><li>Client-provided content, logos, music, images, branding, trademarks, or intellectual property.</li><li>Damage to equipment caused by Client, venue, guests, employees, attendees, sponsors, vendors, contractors, or third parties.</li><li>Unsafe conditions, missing permits, missing approvals, venue restrictions, or inaccurate information provided to Xpress.</li><li>Claims arising from Client’s failure to comply with applicable laws, venue rules, fire code, permit requirements, insurance requirements, or safety requirements.</li><li>Injuries, damages, losses, or claims not caused by the gross negligence or willful misconduct of Xpress Entertainment.</li></ol><p>Xpress agrees to be responsible for its own gross negligence or willful misconduct to the extent required by law.</p>"},
  {"id":"s25","type":"section","title":"25. Independent Contractor","html":"<p>Xpress Entertainment is an independent contractor and is not an employee, partner, joint venturer, or agent of Client.</p><p>Xpress retains control over the manner and means of providing its services, subject to the event details and written instructions agreed upon by the parties.</p>"},
  {"id":"s26","type":"section","title":"26. Subcontractors and Staffing","html":"<p>Xpress may use employees, contractors, subcontractors, DJs, technicians, photo booth attendants, musicians, assistants, or third-party vendors as reasonably necessary to provide the contracted services.</p><p>Xpress is responsible for selecting and managing its own team.</p>"},
  {"id":"s27","type":"section","title":"27. Non-Solicitation","html":"<p>Client agrees not to directly solicit, hire, book, or contract with Xpress Entertainment employees, DJs, MCs, technicians, attendants, musicians, or subcontractors for event services outside of Xpress Entertainment for a period of [12] months following the event, unless approved in writing by Xpress.</p>"},
  {"id":"s28","type":"section","title":"28. No Assignment","html":"<p>Client may not assign or transfer this Agreement to another person, company, entity, date, event, or location without written approval from Xpress.</p>"},
  {"id":"s29","type":"section","title":"29. Disputes, Governing Law, and Attorney’s Fees","html":"<p>This Agreement shall be governed by the laws of the State of Florida.</p><p>Any dispute arising from or related to this Agreement shall be handled in the state or federal courts located in &lt;legal_venue&gt;, unless otherwise required by law.</p><p>The prevailing party in any legal action or collection action related to this Agreement may recover reasonable attorney’s fees, court costs, and collection costs to the extent permitted by law.</p>"},
  {"id":"s30","type":"section","title":"30. Electronic Signatures and Counterparts","html":"<p>This Agreement may be signed electronically. Electronic signatures, scanned signatures, digital signatures, and signatures transmitted by email or electronic signing platform shall be treated as original signatures to the fullest extent permitted by law.</p><p>This Agreement may be signed in counterparts, each of which shall be treated as an original and together shall constitute one agreement.</p>"},
  {"id":"s31","type":"section","title":"31. Entire Agreement","html":"<p>This Agreement, together with any attached proposal, invoice, service schedule, event terms, production rider, payment schedule, or written addendum, represents the entire agreement between the parties.</p><p>Any changes must be approved in writing by both parties, except for on-site changes approved by the Authorized Decision-Maker as described in this Agreement.</p><p>If any part of this Agreement is found invalid or unenforceable, the remaining parts shall remain in effect.</p>"},
  {"id":"exA","type":"section","title":"Exhibit A — Event Details, Services & Payment Schedule","html":"<p>The event details, services included, total fee, and payment schedule for this Agreement are set out below and in any attached proposal or invoice.</p>"},
  {"id":"exA_details","type":"event_details"},
  {"id":"exA_fees","type":"fee_table"},
  {"id":"exA_payments","type":"payment_schedule"},
  {"id":"exA_terms","type":"text","html":"<p><strong>Approved Corporate Billing Terms:</strong> &lt;billing_terms&gt;</p><p><strong>Overtime Rate:</strong> &lt;overtime_rate&gt; per hour, subject to availability and venue approval.</p>"},
  {"id":"exB","type":"section","title":"Exhibit B — Production Rider","html":"<p>The following production needs apply based on the services selected:</p><p><strong>Load-In / Parking</strong> — Client shall provide:</p><ul><li>Parking or parking reimbursement</li><li>Loading area or loading dock access</li><li>Clear load-in path</li><li>Elevator or freight elevator access, if required</li><li>Venue contact for arrival</li><li>Access at least [NUMBER] hours before event start</li></ul><p><strong>Power</strong> — Client shall provide:</p><ul><li>Dedicated power within a reasonable distance of setup</li><li>Safe electrical access</li><li>Power drops or electrician if required by the venue or production setup</li><li>Generator if venue power is unavailable or insufficient</li></ul><p>Unless otherwise specified in writing, Client is responsible for all costs associated with power access, electricians, generators, power drops, cable ramps, venue labor, or union labor.</p><p><strong>Space</strong> — Client shall provide adequate space for all contracted services, including DJ booth, speakers, lighting, photo booth, musicians, special effects, or production equipment.</p><p><strong>Outdoor / Weather Protection</strong> — For outdoor events, Client shall provide a covered, dry, level, and safe setup area protected from rain, wind, direct sprinkler exposure, and unsafe weather conditions.</p><p><strong>Special Effects</strong> — Special effects require written venue approval and any required permits, inspections, fire watch, or fire marshal clearance. Xpress may refuse to operate special effects if the venue, setup area, crowd placement, weather, ceiling height, clearance, or approval status is unsafe or unsuitable.</p>"},
  {"id":"sig_intro","type":"text","html":"<p>By signing below, the parties agree to the terms of this Corporate Event Services Agreement.</p>"},
  {"id":"sig","type":"signature"}
]$blocks$::jsonb,
    updated_at = now()
where id = 'b0fa46bd-63f6-45b2-a648-2de7ac5e021c';
