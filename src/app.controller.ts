import { Controller, Get, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { Response } from 'express';
import { join } from 'path';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Local testing: open http://YOUR_IP:3000/viewer?streamId=STREAM_ID
   * Page is served over HTTP so ws:// connection is not blocked (no mixed content).
   */
  @Get('viewer')
  viewer(@Res({ passthrough: false }) res: Response) {
    res.type('html').sendFile(join(process.cwd(), 'public', 'viewer.html'));
  }
}
