insert into idea_types (name) values ('تصميم فردي')
on conflict (name) do nothing;
