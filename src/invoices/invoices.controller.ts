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
@UseGuards(JwtAuthGuard, BuyerAccessGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('orders/:id/invoice')
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
