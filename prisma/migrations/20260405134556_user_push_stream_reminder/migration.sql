-- No-op: `20260405134500_push_devices_stream_reminder` already created `UserPushDevice`,
-- `Stream.goLiveReminderSentAt`, indexes, and FK. This migration was a duplicate and failed on deploy.
-- After `prisma migrate resolve --rolled-back "20260405134556_user_push_stream_reminder"`, deploy runs this once.
SELECT 1;
