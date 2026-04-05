import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcrypt';
import { randomUUID, randomInt } from 'crypto';
import { Logger } from '@nestjs/common';
import {
  LoginDto,
  RegisterBuyerDto,
  RegisterSellerDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetPasswordDto,
  CheckPhoneExistsDto,
  PickupAddressDto,
} from './dto/auth.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { Role } from '@prisma/client';

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const OTP_LENGTH = 6;

/** Multi-line address aligned with registration pickup fields. */
function formatPickupAsBusinessAddress(p: PickupAddressDto): string {
  const lines = [
    p.line1.trim(),
    p.line2?.trim(),
    `${p.city.trim()}, ${p.state.trim()} ${p.zip.trim()}`,
    'IN',
  ].filter((x): x is string => !!x && x.length > 0);
  return lines.join('\n');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, phone, password } = loginDto;
    if (!email && !phone) {
      throw new BadRequestException('Either email or phone is required');
    }

    const user = await this.prisma.user.findFirst({
      where: email ? { email } : { phone: phone! },
      include: { sellerProfile: true, buyerProfile: true },
    });

    if (!user) {
      throw new UnauthorizedException('Please check your login credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Please check your login credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
    const refreshExpires = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '30d',
    );
    let refreshToken: string | undefined;

    if (refreshSecret) {
      const jti = randomUUID();
      refreshToken = this.jwtService.sign({ ...payload, jti }, {
        secret: refreshSecret,
        expiresIn: refreshExpires,
      } as JwtSignOptions);
      const key = this.redis.refreshTokenKey(jti);
      await this.redis.set(key, user.id, REFRESH_TTL_SECONDS);
    }

    return {
      access_token: accessToken,
      ...(refreshToken && { refresh_token: refreshToken }),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        sellerProfileId: user.sellerProfile?.id,
        buyerProfileId: user.buyerProfile?.id,
      },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new UnauthorizedException('Refresh tokens are not configured');
    }
    try {
      const decoded = this.jwtService.verify<{
        sub: string;
        jti: string;
        email: string;
        roles: Role[];
      }>(dto.refresh_token, { secret: refreshSecret });
      const key = this.redis.refreshTokenKey(decoded.jti);
      const stored = await this.redis.get(key);
      if (!stored || stored !== decoded.sub) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.sub },
        include: { sellerProfile: true, buyerProfile: true },
      });
      if (!user) throw new UnauthorizedException('User not found');
      const payload = { sub: user.id, email: user.email, roles: user.roles };
      const accessToken = this.jwtService.sign(payload);
      return {
        access_token: accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles,
          sellerProfileId: user.sellerProfile?.id,
          buyerProfileId: user.buyerProfile?.id,
        },
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /** Send OTP to email or phone. At least one of email/phone required. */
  async sendOtp(dto: SendOtpDto): Promise<{ message: string }> {
    const { email, phone } = dto;
    if (!email && !phone) {
      throw new BadRequestException('Either email or phone is required');
    }
    const identifier = email ?? phone!;
    const code = randomInt(
      10 ** (OTP_LENGTH - 1),
      10 ** OTP_LENGTH - 1,
    ).toString();
    const key = this.redis.otpKey(identifier);
    await this.redis.set(key, code, OTP_TTL_SECONDS);

    // Production: inject OTP sender (Twilio, SendGrid, etc.) and send code
    const sendViaProvider = this.config.get<string>('OTP_SEND_VIA') === 'true';
    if (sendViaProvider) {
      // TODO: integrate with SMS/Email provider using env (e.g. TWILIO_*, SENDGRID_*)
      this.logger.warn(
        `OTP send not configured; use OTP_SEND_VIA and provider env vars`,
      );
    } else {
      this.logger.log(
        `[DEV] OTP for ${identifier}: ${code} (expires ${OTP_TTL_SECONDS}s)`,
      );
    }

    return { message: 'OTP sent successfully' };
  }

  /**
   * Verify OTP. Returns tokens + user if existing user; returns { isNewUser: true, email?, phone? } if new.
   * TEMP: If code is 796300, skip OTP verification and proceed directly (for dev/testing).
   */
  async verifyOtp(dto: VerifyOtpDto) {
    const { email, phone, code: rawCode } = dto;
    const code = rawCode?.trim() ?? '';
    if (!email && !phone) {
      throw new BadRequestException('Either email or phone is required');
    }
    const identifier = (email ?? phone ?? '').trim();
    if (!identifier) {
      throw new BadRequestException('Either email or phone is required');
    }
    const isTempBypass = code === '796300';
    if (!isTempBypass) {
      const key = this.redis.otpKey(identifier);
      const stored = await this.redis.get(key);
      if (!stored || stored !== code) {
        if (this.config.get('NODE_ENV') === 'development') {
          this.logger.debug(
            `OTP verify failed: key=${key} stored=${stored ?? 'null'} received=${code}`,
          );
        }
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      await this.redis.del(key);
    }

    const user = await this.prisma.user.findFirst({
      where: email ? { email } : { phone: phone! },
      include: { sellerProfile: true, buyerProfile: true },
    });

    if (user) {
      const payload = { sub: user.id, email: user.email, roles: user.roles };
      const accessToken = this.jwtService.sign(payload);
      const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
      const refreshExpires = this.config.get<string>(
        'JWT_REFRESH_EXPIRES_IN',
        '30d',
      );
      let refreshToken: string | undefined;
      if (refreshSecret) {
        const jti = randomUUID();
        refreshToken = this.jwtService.sign({ ...payload, jti }, {
          secret: refreshSecret,
          expiresIn: refreshExpires,
        } as JwtSignOptions);
        await this.redis.set(
          this.redis.refreshTokenKey(jti),
          user.id,
          REFRESH_TTL_SECONDS,
        );
      }
      return {
        access_token: accessToken,
        ...(refreshToken && { refresh_token: refreshToken }),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles,
          sellerProfileId: user.sellerProfile?.id,
          buyerProfileId: user.buyerProfile?.id,
        },
      };
    }

    return {
      isNewUser: true,
      ...(email && { email }),
      ...(phone && { phone }),
    };
  }

  async registerSeller(dto: RegisterSellerDto) {
    const phone = dto.phone?.trim();
    if (!phone) {
      throw new BadRequestException('Phone number is required for registration');
    }
    const email = dto.email.trim();

    const existingByPhone = await this.prisma.user.findUnique({
      where: { phone },
    });
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email },
    });

    // If phone exists, email must match. If email exists but phone doesn't, reject.
    if (existingByPhone) {
      if (existingByPhone.email !== email) {
        throw new ConflictException(
          'An account with this phone number already exists with a different email',
        );
      }
    } else if (existingByEmail) {
      throw new ConflictException('User with this email already exists');
    }

    if (dto.categoryIds?.length) {
      const categories = await this.prisma.category.findMany({
        where: { id: { in: dto.categoryIds } },
      });
      if (categories.length !== dto.categoryIds.length) {
        throw new BadRequestException('One or more category IDs are invalid');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    try {
      await this.prisma.$transaction(async (tx) => {
        const user = existingByPhone
          ? await tx.user.update({
              where: { id: existingByPhone.id },
              data: {
                password: hashedPassword,
                name: dto.name,
                roles: {
                  // Union roles so the same phone can be both buyer + seller.
                  set: Array.from(
                    new Set([...(existingByPhone.roles ?? []), Role.SELLER]),
                  ),
                },
              },
            })
          : await tx.user.create({
              data: {
                email,
                password: hashedPassword,
                name: dto.name,
                phone,
                roles: [Role.SELLER],
              },
            });

        // Create seller profile if missing; otherwise update.
        const existingSeller = await tx.seller.findUnique({
          where: { userId: user.id },
        });
        const primaryCategoryId = dto.categoryIds?.length
          ? dto.categoryIds[0]
          : undefined;
        const businessAddressFromPickup = dto.pickupAddress
          ? formatPickupAsBusinessAddress(dto.pickupAddress)
          : undefined;
        const seller = existingSeller
          ? await tx.seller.update({
              where: { id: existingSeller.id },
              data: {
                businessName: dto.businessName,
                description: dto.description ?? null,
                gstNumber: dto.gstNumber ?? null,
                bankAccount: dto.bankAccount ?? null,
                ifscCode: dto.ifscCode ?? null,
                ...(primaryCategoryId !== undefined && { primaryCategoryId }),
                ...(businessAddressFromPickup !== undefined && {
                  businessAddress: businessAddressFromPickup,
                }),
              },
            })
          : await tx.seller.create({
              data: {
                userId: user.id,
                businessName: dto.businessName,
                description: dto.description ?? null,
                gstNumber: dto.gstNumber ?? null,
                bankAccount: dto.bankAccount ?? null,
                ifscCode: dto.ifscCode ?? null,
                ...(primaryCategoryId !== undefined && { primaryCategoryId }),
                ...(businessAddressFromPickup !== undefined && {
                  businessAddress: businessAddressFromPickup,
                }),
              },
            });

        if (dto.pickupAddress) {
          // Ensure only one default PICKUP address.
          await tx.address.updateMany({
            where: { userId: user.id, type: 'PICKUP' },
            data: { isDefault: false },
          });
          await tx.address.create({
            data: {
              userId: user.id,
              type: 'PICKUP',
              isDefault: true,
              line1: dto.pickupAddress.line1,
              line2: dto.pickupAddress.line2 ?? null,
              city: dto.pickupAddress.city,
              state: dto.pickupAddress.state,
              zip: dto.pickupAddress.zip,
              country: 'IN',
            },
          });
        }

        if (dto.categoryIds?.length) {
          await tx.sellerCategory.deleteMany({
            where: { sellerId: seller.id },
          });
          await tx.sellerCategory.createMany({
            data: dto.categoryIds.map((categoryId) => ({
              sellerId: seller.id,
              categoryId,
            })),
          });
        }
      });

      return this.login({ email: dto.email, password: dto.password });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      )
        throw error;
      throw new ConflictException('Registration failed, please try again.');
    }
  }

  async registerBuyer(dto: RegisterBuyerDto) {
    if (!dto.phone) {
      throw new BadRequestException('Phone number is required for registration');
    }

    const phone = dto.phone.trim();
    const email = dto.email.trim();

    const existingByPhone = await this.prisma.user.findUnique({
      where: { phone },
    });
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email },
    });

    // If phone exists, email must match. If email exists but phone doesn't, reject.
    if (existingByPhone) {
      if (existingByPhone.email !== email) {
        throw new ConflictException(
          'An account with this phone number already exists with a different email',
        );
      }
    } else if (existingByEmail) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Transaction: Create User + Buyer Profile
    try {
      await this.prisma.$transaction(async (prisma) => {
        // 1. Create User
        const user = existingByPhone
          ? await prisma.user.update({
              where: { id: existingByPhone.id },
              data: {
                password: hashedPassword,
                name: dto.name,
                roles: {
                  // Union roles so the same phone can be both buyer + seller.
                  set: Array.from(
                    new Set([...(existingByPhone.roles ?? []), Role.BUYER]),
                  ),
                },
              },
            })
          : await prisma.user.create({
              data: {
                email,
                password: hashedPassword,
                name: dto.name,
                phone,
                roles: [Role.BUYER], // Assign BUYER role
              },
            });

        // Create buyer profile if missing; otherwise keep.
        const existingBuyer = await prisma.buyer.findUnique({
          where: { userId: user.id },
        });
        const buyer = existingBuyer
          ? existingBuyer
          : await prisma.buyer.create({
              data: {
                userId: user.id,
              },
            });

        return { user, buyer };
      });

      // Login immediately
      return this.login({
        email,
        password: dto.password,
      });
    } catch {
      throw new ConflictException('Registration failed, please try again.');
    }
  }

  /** Send OTP to phone for password reset. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const phone = dto.phone.trim();
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new BadRequestException(
        'No account found with this mobile number',
      );
    }
    const code = randomInt(
      10 ** (OTP_LENGTH - 1),
      10 ** OTP_LENGTH - 1,
    ).toString();
    const key = this.redis.otpKey(`reset:${phone}`);
    await this.redis.set(key, code, OTP_TTL_SECONDS);
    if (this.config.get<string>('OTP_SEND_VIA') !== 'true') {
      this.logger.log(
        `[DEV] Reset OTP for ${phone}: ${code} (expires ${OTP_TTL_SECONDS}s)`,
      );
    }
    return { message: 'OTP sent to your mobile number' };
  }

  /** Verify OTP and set new password. */
  async resetPassword(dto: ResetPasswordDto) {
    const { phone, code, newPassword } = dto;
    const key = this.redis.otpKey(`reset:${phone}`);
    const stored = await this.redis.get(key);
    if (!stored || stored !== code.trim()) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new BadRequestException('No account found with this mobile number');
    }
    // Prevent password reuse: ensure the new password is not the same as the current password.
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from your previous password',
      );
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });
    // Delete OTP only after password update succeeds so user can retry if password validation fails.
    await this.redis.del(key);
    return { message: 'Password reset successfully' };
  }

  /** Verify OTP for password reset (forgot-password flow). */
  async verifyResetPasswordOtp(dto: VerifyResetPasswordDto) {
    const { phone, code } = dto;
    const key = this.redis.otpKey(`reset:${phone}`);
    const stored = await this.redis.get(key);
    if (!stored || stored !== code.trim()) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { sellerProfile: true },
    });
    if (!user) {
      throw new BadRequestException(
        'No account found with this mobile number',
      );
    }

    // Do NOT delete OTP here; resetPassword will delete it once the password is updated.
    return { isSeller: user.sellerProfile != null };
  }

  /** Check if a phone already exists in DB (to avoid wasting OTP SMS). */
  async checkPhoneExists(
    dto: CheckPhoneExistsDto,
  ): Promise<{ hasBuyer: boolean; hasSeller: boolean }> {
    const phone = dto.phone.trim();
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { sellerProfile: true, buyerProfile: true },
    });

    return { hasBuyer: !!user?.buyerProfile, hasSeller: !!user?.sellerProfile };
  }

  async registerPushDevice(
    userId: string,
    token: string,
    platform?: string,
  ): Promise<{ ok: boolean }> {
    const t = token.trim();
    const plat = (platform?.trim() || 'android').slice(0, 32);
    await this.prisma.$transaction(async (tx) => {
      await tx.userPushDevice.deleteMany({
        where: { fcmToken: t, userId: { not: userId } },
      });
      await tx.userPushDevice.upsert({
        where: { fcmToken: t },
        create: { userId, fcmToken: t, platform: plat },
        update: { userId, platform: plat },
      });
    });
    return { ok: true };
  }
}
