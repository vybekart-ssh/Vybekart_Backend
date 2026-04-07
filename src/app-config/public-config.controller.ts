import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

@Controller('public')
export class PublicConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  /** Unauthenticated: client compares [BuildConfig.VERSION_CODE] to minAndroidVersionCode. */
  @Get('android-app')
  getAndroidAppConfig() {
    return this.appConfig.getPublicAndroid();
  }
}
