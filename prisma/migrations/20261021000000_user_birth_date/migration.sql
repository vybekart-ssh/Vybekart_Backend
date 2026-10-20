-- Date of birth for buyers and seller partners. Existing users get today's date.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "birthDate" DATE NOT NULL DEFAULT CURRENT_DATE;
