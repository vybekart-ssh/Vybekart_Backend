import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportIssueDto } from './dto/report-issue.dto';
import { SubmitConcernDto } from './dto/submit-concern.dto';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('faqs')
  getFaqs() {
    return this.supportService.getFaqs();
  }

  @Get('contact')
  getContact() {
    return this.supportService.getAccountManagerContact();
  }

  @Get('escalation-levels')
  getEscalationLevels() {
    return this.supportService.getEscalationLevels();
  }

  @Post('report-issue')
  @UseGuards(JwtAuthGuard)
  reportIssue(
    @Request() req: { user: { id: string } },
    @Body() dto: ReportIssueDto,
  ) {
    return this.supportService.reportIssue(req.user.id, dto);
  }

  @Post('submit-concern')
  @UseGuards(JwtAuthGuard)
  submitConcern(
    @Request() req: { user: { id: string } },
    @Body() dto: SubmitConcernDto,
  ) {
    return this.supportService.submitConcern(req.user.id, dto);
  }
}
