import {
  Controller,
  Post,
  Body,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RefreshTokenDto,
  RegisterBuyerDto,
  RegisterSellerDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetPasswordDto,
  CheckPhoneExistsDto,
  RegisterFcmTokenDto,
} from './dto/auth.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('register/buyer')
  async registerBuyer(@Body() dto: RegisterBuyerDto) {
    return this.authService.registerBuyer(dto);
  }

  @Post('otp/send')
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('register/seller')
  async registerSeller(@Body() dto: RegisterSellerDto) {
    return this.authService.registerSeller(dto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('reset-password/verify')
  async verifyResetPasswordOtp(@Body() dto: VerifyResetPasswordDto) {
    return this.authService.verifyResetPasswordOtp(dto);
  }

  @Post('check-phone')
  async checkPhone(@Body() dto: CheckPhoneExistsDto) {
    return this.authService.checkPhoneExists(dto);
  }

  @Patch('me/fcm-token')
  @UseGuards(JwtAuthGuard)
  registerFcmToken(
    @Request() req: { user: { id: string } },
    @Body() dto: RegisterFcmTokenDto,
  ) {
    return this.authService.registerPushDevice(
      req.user.id,
      dto.token,
      dto.platform,
    );
  }
}
