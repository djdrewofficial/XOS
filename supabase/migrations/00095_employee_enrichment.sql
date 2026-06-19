-- XOS — enrich existing employees from the DJEP employee export.
-- Matched by legacy_djep_id; BACKFILLS blanks only (coalesce), so it never
-- overwrites edited values and is safe to re-run. Pay/commission, permission
-- tier, and is_active are intentionally left untouched (per Drew).

alter table employees
  add column if not exists middle_name text,
  add column if not exists website text,
  add column if not exists employment_type text,
  add column if not exists planning_meeting_url text;

-- Andrew Segura (47715)
update employees set
  email = coalesce(nullif(email, ''), 'drew@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '9548651862'),
  profession_since = coalesce(profession_since, 2016),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Drew Segura'),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2024/09/Drew-Circle.png'),
  planning_meeting_url = coalesce(nullif(planning_meeting_url, ''), 'https://api.leadconnectorhq.com/widget/bookings/drewplanning')
where legacy_djep_id = '47715';

-- Darlene Fisher (47818)
update employees set
  email = coalesce(nullif(email, ''), 'darlene@xpressdjs.com'),
  profession_since = coalesce(profession_since, 2022),
  website = coalesce(nullif(website, ''), 'https://www.xpressdjs.com')
where legacy_djep_id = '47818';

-- Jaden Jones (47819)
update employees set
  email = coalesce(nullif(email, ''), 'jaden@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '9542480259'),
  profession_since = coalesce(profession_since, 2022)
where legacy_djep_id = '47819';

-- Victor Abrams (47820)
update employees set
  email = coalesce(nullif(email, ''), 'victor@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '5618592751'),
  profession_since = coalesce(profession_since, 2022)
where legacy_djep_id = '47820';

-- Frank Jimenez (47822)
update employees set
  email = coalesce(nullif(email, ''), 'frank@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '754551594'),
  profession_since = coalesce(profession_since, 2022)
where legacy_djep_id = '47822';

-- Drew Wofford (47824)
update employees set
  email = coalesce(nullif(email, ''), 'dwofford@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '9195228283'),
  profession_since = coalesce(profession_since, 2022),
  birthday = coalesce(birthday, '1990-07-17'::date),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Drew Wofford'),
  website = coalesce(nullif(website, ''), 'https://Xpressdjs.com')
where legacy_djep_id = '47824';

-- Stephanie Estrada (47825)
update employees set
  email = coalesce(nullif(email, ''), 'stephanie@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '9549931049'),
  profession_since = coalesce(profession_since, 2023),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2024/09/Untitled-design-7.png')
where legacy_djep_id = '47825';

-- Naqeeb Mohammed (47826)
update employees set
  email = coalesce(nullif(email, ''), 'naqeeb@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '7544238923'),
  notes = coalesce(nullif(notes, ''), 'Diet restrictions: No meat seafood (veggie is fine)'),
  profession_since = coalesce(profession_since, 2023),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Naqeeb')
where legacy_djep_id = '47826';

-- DJ Rere (47827)
update employees set
  email = coalesce(nullif(email, ''), 'djrere7@gmail.com'),
  phone = coalesce(nullif(phone, ''), '4027075846'),
  notes = coalesce(nullif(notes, ''), 'Diet restrictions: No shellfish'),
  profession_since = coalesce(profession_since, 2023),
  birthday = coalesce(birthday, '2023-09-08'::date),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ ReRe'),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2024/09/DJ-Rere-Circle-300x300.png'),
  website = coalesce(nullif(website, ''), 'https://Remixedevents.com')
where legacy_djep_id = '47827';

-- Travis Wilcox (47828)
update employees set
  email = coalesce(nullif(email, ''), 'travis@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '3367059247'),
  profession_since = coalesce(profession_since, 2023),
  website = coalesce(nullif(website, ''), 'https://xpressdjs.com')
where legacy_djep_id = '47828';

-- Glenn Black (47829)
update employees set
  email = coalesce(nullif(email, ''), 'glennblakk@gmail.com'),
  phone = coalesce(nullif(phone, ''), '9544447887'),
  notes = coalesce(nullif(notes, ''), 'Diet restriction: Pescetarian diet only'),
  profession_since = coalesce(profession_since, 2023),
  stage_name = coalesce(nullif(stage_name, ''), 'Dj Glenn Blakk')
where legacy_djep_id = '47829';

-- Erick Rustavo (47830)
update employees set
  email = coalesce(nullif(email, ''), 'restivoeric@gmail.com'),
  phone = coalesce(nullif(phone, ''), '3233085224'),
  profession_since = coalesce(profession_since, 2023),
  stage_name = coalesce(nullif(stage_name, ''), 'Dj Eric Cali')
where legacy_djep_id = '47830';

-- Alexandre Ferbeyre (47831)
update employees set
  email = coalesce(nullif(email, ''), 'alex@alexferbeyre.com'),
  phone = coalesce(nullif(phone, ''), '3058014055'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Alex Ferbeyre'),
  middle_name = coalesce(nullif(middle_name, ''), 'Armando'),
  website = coalesce(nullif(website, ''), 'https://alexferbeyre.com')
where legacy_djep_id = '47831';

-- Jake Narey (47832)
update employees set
  email = coalesce(nullif(email, ''), 'jake@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '2623095857'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Maeko'),
  website = coalesce(nullif(website, ''), 'https://xpressdjs.com')
where legacy_djep_id = '47832';

-- John Svadbik (47833)
update employees set
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'Villa Toscana Miami')
where legacy_djep_id = '47833';

-- Alexander Bolivar (47834)
update employees set
  email = coalesce(nullif(email, ''), 'theprojectal.p@gmail.com'),
  phone = coalesce(nullif(phone, ''), '9737254889'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ AL Pizzle')
where legacy_djep_id = '47834';

-- Dimitri Fontenelle (47835)
update employees set
  email = coalesce(nullif(email, ''), 'djatomic@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '7274209499'),
  notes = coalesce(nullif(notes, ''), 'Diet restrictions: None'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Atomic'),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2024/09/af6777b5-97bb-4815-b903-342d8f707c50-1024x684.jpg'),
  planning_meeting_url = coalesce(nullif(planning_meeting_url, ''), 'https://www.xpressdjs.com/atomicplanning')
where legacy_djep_id = '47835';

-- Diego Sayago (47836)
update employees set
  email = coalesce(nullif(email, ''), 'diego@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '+573183514443'),
  profession_since = coalesce(profession_since, 2024),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2024/09/Untitled-design-1.jpg'),
  website = coalesce(nullif(website, ''), 'https://xpressdjs.com'),
  employment_type = coalesce(nullif(employment_type, ''), 'Full-Time')
where legacy_djep_id = '47836';

-- Kelly Flavour (47837)
update employees set
  email = coalesce(nullif(email, ''), 'djkellyflavour@gmail.com'),
  phone = coalesce(nullif(phone, ''), '9548228148'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Kelly')
where legacy_djep_id = '47837';

-- Phil Santos (47838)
update employees set
  email = coalesce(nullif(email, ''), 'phil@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '5082466669'),
  notes = coalesce(nullif(notes, ''), 'Diet restrictions: gluten free and dairy free'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'Dj Phil Santos'),
  planning_meeting_url = coalesce(nullif(planning_meeting_url, ''), 'https://xpressdjs.com/philplanning')
where legacy_djep_id = '47838';

-- Marco Clemente (47839)
update employees set
  email = coalesce(nullif(email, ''), 'marco@xpressdjs.com'),
  profession_since = coalesce(profession_since, 2024)
where legacy_djep_id = '47839';

-- Delfi Biedma (47840)
update employees set
  email = coalesce(nullif(email, ''), 'delfi@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '7868982855'),
  notes = coalesce(nullif(notes, ''), 'Diet restrictions: None'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Delfi Biedma'),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2024/09/Delfi-Circle-300x300.png'),
  website = coalesce(nullif(website, ''), 'https://xpressdjs.com/djdelfibiedma/')
where legacy_djep_id = '47840';

-- Megan Ramos (47841)
update employees set
  email = coalesce(nullif(email, ''), 'megan@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '9545574515'),
  notes = coalesce(nullif(notes, ''), 'Diet restrictions: No ham/salmon, protein forward meals.'),
  profession_since = coalesce(profession_since, 2024),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2024/09/Untitled-design-5.png')
where legacy_djep_id = '47841';

-- Daniel Rojas (47842)
update employees set
  email = coalesce(nullif(email, ''), 'specialmemoriesfl@gmail.com'),
  phone = coalesce(nullif(phone, ''), '9545042185'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'Special Memories Photobooth'),
  middle_name = coalesce(nullif(middle_name, ''), 'Gamarra')
where legacy_djep_id = '47842';

-- Patricio Lopez (47843)
update employees set
  email = coalesce(nullif(email, ''), 'readyplayent@gmail.com'),
  phone = coalesce(nullif(phone, ''), '3053439065'),
  profession_since = coalesce(profession_since, 2024),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ P-LO')
where legacy_djep_id = '47843';

-- Meet Kumar (47845)
update employees set
  email = coalesce(nullif(email, ''), 'meetleemani8@gmail.com'),
  phone = coalesce(nullif(phone, ''), '7867291872'),
  profession_since = coalesce(profession_since, 2025)
where legacy_djep_id = '47845';

-- Helen Fisher (47846)
update employees set
  email = coalesce(nullif(email, ''), 'helen@xpressdjs.com'),
  profession_since = coalesce(profession_since, 2025),
  photo_path = coalesce(nullif(photo_path, ''), 'https://xpressdjs.com/wp-content/uploads/2025/01/IMG_0356.jpeg'),
  middle_name = coalesce(nullif(middle_name, ''), 'Darlene')
where legacy_djep_id = '47846';

-- Ruben Cantero (47847)
update employees set
  email = coalesce(nullif(email, ''), 'rubekntro0205@outlook.es'),
  phone = coalesce(nullif(phone, ''), '4016447892'),
  profession_since = coalesce(profession_since, 2025),
  emergency_contact = coalesce(nullif(emergency_contact, ''), 'Joyseth Oyola - 401-499-6591')
where legacy_djep_id = '47847';

-- Aaron Timberlake (47848)
update employees set
  email = coalesce(nullif(email, ''), 'aaron@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '5867647209'),
  profession_since = coalesce(profession_since, 2025)
where legacy_djep_id = '47848';

-- Natasha Maherault (47849)
update employees set
  email = coalesce(nullif(email, ''), 'natasha@xpressdjs.com'),
  profession_since = coalesce(profession_since, 2025)
where legacy_djep_id = '47849';

-- Augusto Rios (47850)
update employees set
  email = coalesce(nullif(email, ''), 'powellgus.ar@gmail.com'),
  phone = coalesce(nullif(phone, ''), '7547792535'),
  profession_since = coalesce(profession_since, 2025),
  emergency_contact = coalesce(nullif(emergency_contact, ''), 'Jamie Perez  9546549897'),
  middle_name = coalesce(nullif(middle_name, ''), 'Ernesto')
where legacy_djep_id = '47850';

-- Sasha Mangarre (47851)
update employees set
  email = coalesce(nullif(email, ''), 'smangarre@gmail.com'),
  phone = coalesce(nullif(phone, ''), '3057339408'),
  profession_since = coalesce(profession_since, 2025),
  stage_name = coalesce(nullif(stage_name, ''), 'Sasha')
where legacy_djep_id = '47851';

-- Julian Gabourel (47852)
update employees set
  profession_since = coalesce(profession_since, 2025)
where legacy_djep_id = '47852';

-- Will Calder (47853)
update employees set
  email = coalesce(nullif(email, ''), 'me@djwillcalder.com'),
  phone = coalesce(nullif(phone, ''), '3126223322'),
  profession_since = coalesce(profession_since, 2025),
  stage_name = coalesce(nullif(stage_name, ''), 'DJ Will Calder')
where legacy_djep_id = '47853';

-- Alan Aldo (47854)
update employees set
  email = coalesce(nullif(email, ''), 'alanaldaomusic@gmail.com'),
  phone = coalesce(nullif(phone, ''), '7862227410'),
  profession_since = coalesce(profession_since, 2025)
where legacy_djep_id = '47854';

-- Junior Carrascal (47855)
update employees set
  email = coalesce(nullif(email, ''), 'edgarcarrascal22@gmail.com'),
  phone = coalesce(nullif(phone, ''), '8019183767'),
  profession_since = coalesce(profession_since, 2025)
where legacy_djep_id = '47855';

-- Laura Del Gordo (47856)
update employees set
  email = coalesce(nullif(email, ''), 'laura@xpressdjs.com'),
  phone = coalesce(nullif(phone, ''), '+57 321 3427214'),
  profession_since = coalesce(profession_since, 2026),
  website = coalesce(nullif(website, ''), 'https://Xpressdjs.com')
where legacy_djep_id = '47856';

-- Isabella Hernandez (47857)
update employees set
  email = coalesce(nullif(email, ''), 'isabella@xpressdjs.com'),
  profession_since = coalesce(profession_since, 2026)
where legacy_djep_id = '47857';
