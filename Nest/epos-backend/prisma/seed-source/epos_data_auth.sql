-- Akun login (auth.users + auth.identities) supaya temanmu bisa masuk dengan
-- admin@eposac.local / kasir@ / teknisi@ (password sama seperti seed.sql).
-- Muat SETELAH epos_data_public.sql.
set session_replication_role = replica;
--
-- PostgreSQL database dump
--

\restrict baY5xcI6kWRtXjs83RNJbPRHLWdmZlcAdzVDyUsBz9JDf5rng4KyfWAuhSXMBbS

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous) FROM stdin;
00000000-0000-0000-0000-000000000000	00000000-0000-0000-0000-000000000003	authenticated	authenticated	teknisi@eposac.local	$2a$06$AqIGhs5xwxwBGV2AxC4oVuIvSG3tn1pi3R.VYIcP1.9HJi700jLK.	2026-07-17 04:03:25.385617+00	\N		\N		\N			\N	2026-08-06 07:02:38.144578+00	{"provider": "email", "providers": ["email"]}	{"display_name": "Teknisi Andi"}	\N	2026-07-17 04:03:25.385617+00	2026-08-06 07:02:38.159611+00	\N	\N			\N		0	\N		\N	f	\N	f
00000000-0000-0000-0000-000000000000	00000000-0000-0000-0000-000000000002	authenticated	authenticated	kasir@eposac.local	$2a$06$WgAQZDfuwOIa57Yq71CyXuK57hTZRAVScIpVGp8CkJAjHnLy50gmO	2026-07-17 04:03:25.385617+00	\N		\N		\N			\N	2026-08-05 15:37:54.27031+00	{"provider": "email", "providers": ["email"]}	{"display_name": "Kasir Dewi"}	\N	2026-07-17 04:03:25.385617+00	2026-08-05 15:37:54.284909+00	\N	\N			\N		0	\N		\N	f	\N	f
00000000-0000-0000-0000-000000000000	00000000-0000-0000-0000-000000000001	authenticated	authenticated	admin@eposac.local	$2a$06$611Gx874nzy6Nb6gmOwU3OyoIlyIuRlLh5ML4/snadAiZPJHVG7ei	2026-07-17 04:03:25.385617+00	\N		\N		\N			\N	2026-08-06 18:23:48.318362+00	{"provider": "email", "providers": ["email"]}	{"display_name": "Admin Ayub"}	\N	2026-07-17 04:03:25.385617+00	2026-08-06 18:23:48.325196+00	\N	\N			\N		0	\N		\N	f	\N	f
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id) FROM stdin;
00000000-0000-0000-0000-000000000001	00000000-0000-0000-0000-000000000001	{"sub": "00000000-0000-0000-0000-000000000001", "email": "admin@eposac.local"}	email	2026-07-17 04:03:25.385617+00	2026-07-17 04:03:25.385617+00	2026-07-17 04:03:25.385617+00	e7d9dd7a-ed37-45bc-aae9-5be9ea659ac5
00000000-0000-0000-0000-000000000002	00000000-0000-0000-0000-000000000002	{"sub": "00000000-0000-0000-0000-000000000002", "email": "kasir@eposac.local"}	email	2026-07-17 04:03:25.385617+00	2026-07-17 04:03:25.385617+00	2026-07-17 04:03:25.385617+00	36a46cc7-9eeb-48d0-894f-fd2c93875aa1
00000000-0000-0000-0000-000000000003	00000000-0000-0000-0000-000000000003	{"sub": "00000000-0000-0000-0000-000000000003", "email": "teknisi@eposac.local"}	email	2026-07-17 04:03:25.385617+00	2026-07-17 04:03:25.385617+00	2026-07-17 04:03:25.385617+00	4403bbb0-1d47-4aa5-ac4e-c2c8da1d9029
\.


--
-- PostgreSQL database dump complete
--

\unrestrict baY5xcI6kWRtXjs83RNJbPRHLWdmZlcAdzVDyUsBz9JDf5rng4KyfWAuhSXMBbS

set session_replication_role = origin;
