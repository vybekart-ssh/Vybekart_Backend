import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const { method, originalUrl } = req;
      const statusCode = res.statusCode;
      this.logger.log(
        `${method} ${originalUrl} ${statusCode} ${duration}ms - ${requestId}`,
      );
    });
    next();
  }
}
