import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { SellerEmailService } from './seller-email.service';
import {
  ParseSellerEmailCsvDto,
  PreviewSellerEmailDto,
  SendSellerEmailsDto,
} from './dto/seller-email.dto';
import { SELLER_EMAIL_LABELS } from './seller-email.types';

@SkipThrottle()
@Controller('admin/seller-emails')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSellerEmailsController {
  constructor(private readonly sellerEmails: SellerEmailService) {}

  @Post('parse-csv')
  parseCsv(@Body() dto: ParseSellerEmailCsvDto) {
    const recipients = this.sellerEmails.parseRecipientsFromCsv(dto.csvContent);
    return { count: recipients.length, recipients };
  }

  @Post('preview')
  preview(@Body() dto: PreviewSellerEmailDto) {
    const built = this.sellerEmails.buildEmail(
      dto.kind,
      dto.recipient,
      true,
    );
    return {
      kind: dto.kind,
      label: SELLER_EMAIL_LABELS[dto.kind],
      subject: built.subject,
      html: built.html,
      text: built.text,
    };
  }

  @Post('send')
  async send(@Body() dto: SendSellerEmailsDto) {
    return this.sellerEmails.sendBatch({
      kind: dto.kind,
      recipients: dto.recipients,
      dryRun: dto.dryRun,
    });
  }
}
