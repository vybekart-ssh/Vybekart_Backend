BEGIN;
CREATE TEMP TABLE IF NOT EXISTS tmp_restore_user (id text, email text, phone text, name text, isActive boolean, roles text, createdAt timestamptz, updatedAt timestamptz) ON COMMIT DROP;
TRUNCATE TABLE tmp_restore_user;
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('afbf9cb1-a4b4-4d35-8ef6-55d6d96782d1','Ssssss@gmail.com','+919821941170','Sssss',TRUE,'SELLER','2026-04-29T07:15:07.738Z','2026-04-29T07:15:07.738Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('5ec65029-7f6d-4129-bdc9-ed0a2e34f91a','kishoride507@gmail.com','+919987625362','kishor ide',TRUE,'BUYER','2026-04-23T19:14:47.302Z','2026-04-23T19:14:47.302Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('5f10138f-9c17-407d-8972-d4a001065e26','dakshprajapati6182@gmail.com','+919725439605','Daksh Prajapati',TRUE,'BUYER','2026-04-23T06:28:52.610Z','2026-04-23T06:28:52.610Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('3a19c995-4e4d-4d5d-82bd-c46140379e8f','apurva.pk.shah@gmail.com','+919824112118','Apurva Shah',TRUE,'BUYER','2026-04-22T09:05:09.092Z','2026-04-22T09:05:09.092Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('45adca4e-8491-4f2f-8db3-4ab9eb7cf0b6','shubhampol3006@gmail.com','+919821941106','Shubham Pol',TRUE,'BUYER','2026-04-21T15:13:59.275Z','2026-04-21T15:13:59.275Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('774cb614-b81d-43e9-8ea6-e1b2433d1d36','kunalkhandait64@gmail.com','+917715859826','Kunal Khandait',TRUE,'BUYER','2026-04-21T07:48:46.372Z','2026-04-21T07:48:46.372Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('1ea03216-1fd7-4046-a913-5ef1a9f7d23a','panchal.reena009@gmail.com','+917738407670','Reena Panchal',TRUE,'BUYER','2026-04-21T07:35:42.970Z','2026-04-21T07:35:42.970Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('82d51074-3302-427b-9de5-2bd1162d9e38','mayankprajapati5617@gmail.com','+919913524540','Mayank Prajapati',TRUE,'BUYER','2026-04-21T06:34:07.938Z','2026-04-21T06:34:07.938Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('e0d0f021-42a7-4629-bc5e-269d52122c45','niravbhanushali06@gmail.com','+917678087540','nirav bhanushali',TRUE,'BUYER','2026-04-19T14:17:16.154Z','2026-04-19T14:17:16.154Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('98c27c19-18b4-4d29-bad8-d9dbc113201e','dhruvrathod.dr9@gmail.com','+919769858834','Dhruv Rathod',TRUE,'BUYER','2026-04-19T13:54:33.519Z','2026-04-19T13:54:33.519Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('e1b739af-ee18-4455-815b-09d4e33fec9e','shubhamwairkar17@gmail.com','+918459538044','Shubham Sanjay Wairkar',TRUE,'BUYER','2026-04-18T16:44:54.721Z','2026-04-18T16:44:54.721Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('7cb56dae-88fe-4f2d-870c-7f167920032a','abdas20004@gmail.com','+917506520574','Akash Das',TRUE,'BUYER','2026-04-18T12:53:12.783Z','2026-04-18T12:53:12.783Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('817c34df-4969-40e6-824e-059d59223bb7','jiteshpanchal0@gmail.com','+919833584295','Jitesh Panchal',TRUE,'BUYER','2026-04-18T12:52:33.884Z','2026-04-18T12:52:33.884Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('b4e0e194-d3b4-4f7e-9e3e-432445103bed','yashxpanchal26@gmail.com','+919920816096','Yash Panchal',TRUE,'BUYER','2026-04-18T12:52:09.584Z','2026-04-18T12:52:09.584Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('87af29aa-af75-4f1e-98f6-6efd9607f148','jp4817624@gmail.com','+917738716237','Jay Prajapati',TRUE,'BUYER','2026-04-17T17:17:23.073Z','2026-04-17T17:17:23.073Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('51b73846-f271-4276-b465-a265654f1737','chirag.oza300@gmail.com','+918866619732','chirag oza',TRUE,'BUYER','2026-04-17T17:16:14.374Z','2026-04-17T17:16:14.374Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('c265b511-3acf-405f-a8c6-69a002da5907','shubhampol@gmail.com','+919757404040','Shubham Pol',TRUE,'SELLER','2026-04-12T18:15:24.999Z','2026-04-12T18:15:24.999Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('b13a0ca9-0c0b-4b16-b9ec-8dbfc0fb48c6','yash@gmail.com','+919757404013','Yash',TRUE,'BUYER','2026-04-12T12:59:00.611Z','2026-04-12T12:59:00.611Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('43c1a43e-a5bf-4244-a202-d8fcda47c8da','vishalaua98@gmail.com','+919797404013','Vishal Ugalmugale',TRUE,'BUYER','2026-04-10T17:54:38.481Z','2026-04-10T17:54:38.481Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('03f45bc2-14e3-4eed-af3c-ed4ab630a619','hp720514@gmail.com','+919324297252','Bhavna Prajapati',TRUE,'BUYER','2026-04-10T14:01:52.644Z','2026-04-10T14:01:52.644Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('25826398-6e59-49cf-85c5-e4a9c3fb6c8f','vybekart88@gmail.com',NULL,'VybeKart Master',TRUE,'ADMIN','2026-04-07T21:24:23.481Z','2026-04-07T21:24:23.481Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('83218adb-4fa8-404d-bdc5-e6ea8aa00ea4','hirenprajapati639@gmail.com','+918169139848','Hiren',TRUE,'BUYER|SELLER','2026-03-30T18:01:10.885Z','2026-04-18T02:20:23.039Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('8803662e-f76d-4b8e-ac54-ca5d8b867c42','vishalaua97@gmail.com','+918425990155','Vishal Ugalmugale',TRUE,'BUYER','2026-03-30T17:42:02.026Z','2026-03-30T17:42:02.026Z');
INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES ('3d70e50d-2cf7-4b75-bb95-056e99605d8b','vishalaua23@gmail.com','+918425990154','Vishal Ugalmugale',TRUE,'SELLER|BUYER','2026-03-30T17:22:49.605Z','2026-03-30T17:22:49.605Z');
INSERT INTO public."User" (id, email, phone, password, name, "isActive", roles, "createdAt", "updatedAt")
SELECT id, email, phone, '__RESTORED_NO_PASSWORD__', name, COALESCE(isActive, true), (select array_agg(r::"Role") from unnest(string_to_array(roles, '|')) as r), createdAt, updatedAt
FROM tmp_restore_user
ON CONFLICT (email) DO UPDATE SET
  phone = EXCLUDED.phone,
  name = EXCLUDED.name,
  "isActive" = EXCLUDED."isActive",
  roles = EXCLUDED.roles,
  "updatedAt" = EXCLUDED."updatedAt";
COMMIT;