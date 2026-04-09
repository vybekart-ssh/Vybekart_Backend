import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type {
  BorzoCalculateOrderRequest,
  BorzoCreateOrderRequest,
  BorzoEnv,
  BorzoErrorResponse,
  BorzoOkResponse,
} from './borzo.types';

@Injectable()
export class BorzoService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private env(): BorzoEnv {
    return (this.config.get<string>('BORZO_ENV') ?? 'test') as BorzoEnv;
  }

  private baseUrl(): string {
    return this.env() === 'prod'
      ? 'https://robot-in.borzodelivery.com/api/business/1.6'
      : 'https://robotapitest-in.borzodelivery.com/api/business/1.6';
  }

  private token(): string {
    const env = this.env();
    const t =
      env === 'prod'
        ? this.config.get<string>('BORZO_AUTH_TOKEN_PROD')
        : this.config.get<string>('BORZO_AUTH_TOKEN_TEST');
    if (!t) {
      throw new InternalServerErrorException(
        `Borzo auth token is not configured for env=${env}`,
      );
    }
    return t;
  }

  async calculate(req: BorzoCalculateOrderRequest) {
    return this.post<BorzoCalculateOrderRequest, unknown>('/calculate-order', req);
  }

  async createOrder(req: BorzoCreateOrderRequest) {
    return this.post<BorzoCreateOrderRequest, unknown>('/create-order', req);
  }

  async getOrders(params?: { order_id?: number; client_order_id?: string }) {
    const url = new URL(this.baseUrl() + '/orders');
    if (params?.order_id != null) url.searchParams.set('order_id', String(params.order_id));
    if (params?.client_order_id) url.searchParams.set('client_order_id', params.client_order_id);
    const token = this.token();
    try {
      const res = await firstValueFrom(
        this.http.get(url.toString(), {
          headers: { 'X-DV-Auth-Token': token },
        }),
      );
      return res.data;
    } catch (e: any) {
      const data = e?.response?.data;
      const status = e?.response?.status;
      if (status === 400 && data?.is_successful === false) {
        throw new BadRequestException(data);
      }
      throw new InternalServerErrorException(
        data?.errors?.join(', ') ?? e?.message ?? 'Borzo request failed',
      );
    }
  }

  async getCourier(orderId: number) {
    return this.post<{ order_id: number }, unknown>('/courier', { order_id: orderId });
  }

  private async post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
    const token = this.token();
    try {
      const res = await firstValueFrom(
        this.http.post(this.baseUrl() + path, body, {
          headers: {
            'X-DV-Auth-Token': token,
            'Content-Type': 'application/json',
          },
        }),
      );
      const data = res.data as BorzoOkResponse<TRes> | BorzoErrorResponse | TRes;
      if ((data as any)?.is_successful === false) {
        throw new BadRequestException(data);
      }
      return data as any;
    } catch (e: any) {
      const data = e?.response?.data;
      const status = e?.response?.status;
      if (status === 400 && data?.is_successful === false) {
        throw new BadRequestException(data);
      }
      throw new InternalServerErrorException(
        data?.errors?.join(', ') ?? e?.message ?? 'Borzo request failed',
      );
    }
  }
}

