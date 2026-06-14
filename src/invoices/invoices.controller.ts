import {
  Controller,
  Get,
  Param,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuyerAccessGuard } from '../auth/buyer-access.guard';
import { InvoicesService } from './invoices.service';

@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** Public sample PDF for layout review — no auth required. */
  @Get('invoices/sample')
  async sampleInvoice(@Res() res: Response) {
    const { buffer, filename } = await this.invoices.generateSampleInvoicePdf();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename}"`,
    );
    res.send(buffer);
  }

  @Get('orders/:id/invoice')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  async orderInvoice(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.invoices.generateOrderInvoicePdf(
      id,
      req.user.id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(buffer);
  }

  @Get('replacements/:id/invoice')
  @UseGuards(JwtAuthGuard, BuyerAccessGuard)
  async replacementInvoice(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } =
      await this.invoices.generateReplacementInvoicePdf(id, req.user.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(buffer);
  }
}
