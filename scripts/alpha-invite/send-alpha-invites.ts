/**
 * Sends the VybeKart Android alpha / APK invite from a registrations CSV (Resend).
 *
 * Prefer the unified entry point (same flags and env):
 *   npx ts-node --transpile-only scripts/email/send-registrations-mail.ts --mail alpha
 *
 * This file is kept so older docs and muscle memory still work:
 *   npx ts-node --transpile-only scripts/alpha-invite/send-alpha-invites.ts
 */

import { loadBackendDotEnv } from '../email/registrations-csv';
import { runSendRegistrationsMail } from '../email/send-registrations-mail';

loadBackendDotEnv();

runSendRegistrationsMail({ mailKind: 'alpha' }).catch((e) => {
  console.error(e);
  process.exit(1);
});
