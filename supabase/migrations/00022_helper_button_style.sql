-- XOS — DJEP-parity button settings: font size + weight on booking helper buttons.
alter table booking_helpers add column if not exists button_font_size int not null default 16;
alter table booking_helpers add column if not exists button_font_weight int not null default 900;
