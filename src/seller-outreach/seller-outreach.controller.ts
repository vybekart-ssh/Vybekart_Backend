import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { SellerOutreachService } from './seller-outreach.service';

@SkipThrottle()
@Controller('public/seller-outreach')
export class SellerOutreachController {
  constructor(private readonly outreach: SellerOutreachService) {}

  @Get('interested')
  async interested(
    @Query('email') email: string,
    @Query('store') store: string,
    @Query('contact') contact: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const payload = {
      email: (email ?? '').trim(),
      store: (store ?? '').trim(),
      contact: (contact ?? '').trim(),
    };

    if (!payload.email || !payload.store || !payload.contact || !sig?.trim()) {
      res.status(400).type('html').send(thankYouPage(false, 'Missing information in this link.'));
      return;
    }

    const result = await this.outreach.handleInterestClick(payload, sig);
    res
      .status(result.ok ? 200 : 400)
      .type('html')
      .send(thankYouPage(result.ok, result.message));
  }
}

function thankYouPage(ok: boolean, message: string): string {
  const title = ok ? 'Thank you!' : 'Something went wrong';
  const color = ok ? '#1565C0' : '#B91C1C';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — Vybekart</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F0F4F8;margin:0;padding:24px;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{max-width:480px;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 8px 30px rgba(11,30,91,.08);text-align:center}
    h1{margin:0 0 12px;font-size:28px;color:${color}}
    p{margin:0;font-size:16px;line-height:1.6;color:#334155}
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
