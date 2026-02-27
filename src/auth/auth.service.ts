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
} from './dto/auth.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { Role } from '@prisma/client';

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const OTP_LENGTH = 6;

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
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
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
    const { email, phone, code } = dto;
    if (!email && !phone) {
      throw new BadRequestException('Either email or phone is required');
    }
    const identifier = email ?? phone!;
    const isTempBypass = code === '796300';
    if (!isTempBypass) {
      const key = this.redis.otpKey(identifier);
      const stored = await this.redis.get(key);
      if (!stored || stored !== code) {
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
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }
    const existingPhone = await this.prisma.user.findUnique({
      where: { phone },
    });
    if (existingPhone) {
      throw new ConflictException('An account with this phone number already exists');
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
        const user = await tx.user.create({
          data: {
            email: dto.email,
            password: hashedPassword,
            name: dto.name,
            phone,
            roles: [Role.SELLER],
          },
        });

        const seller = await tx.seller.create({
          data: {
            userId: user.id,
            businessName: dto.businessName,
            description: dto.description ?? null,
            gstNumber: dto.gstNumber ?? null,
            bankAccount: dto.bankAccount ?? null,
            ifscCode: dto.ifscCode ?? null,
          },
        });

        if (dto.pickupAddress) {
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
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Transaction: Create User + Buyer Profile
    try {
      await this.prisma.$transaction(async (prisma) => {
        // 1. Create User
        const user = await prisma.user.create({
          data: {
            email: dto.email,
            password: hashedPassword,
            name: dto.name,
            phone: dto.phone,
            roles: [Role.BUYER], // Assign BUYER role
          },
        });

        // 2. Create Buyer Profile
        const buyer = await prisma.buyer.create({
          data: {
            userId: user.id,
            // Default empty fields
          },
        });

        return { user, buyer };
      });

      // Login immediately
      return this.login({ email: dto.email, password: dto.password });
    } catch {
      throw new ConflictException('Registration failed, please try again.');
    }
  }
}
