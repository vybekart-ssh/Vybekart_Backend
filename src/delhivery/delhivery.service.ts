import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type {
  DelhiveryCreateShipmentParams,
  DelhiveryCreateShipmentResult,
  DelhiveryEnv,
  DelhiveryShippingCostParams,
  DelhiveryShippingCostResult,
} from './delhivery.types';

@Injectable()
export class DelhiveryService {
  private readonly logger = new Logger(DelhiveryService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return !!this.apiToken()?.trim();
  }

  private env(): DelhiveryEnv {
    return (this.config.get<string>('DELHIVERY_ENV') ?? 'staging') as DelhiveryEnv;
  }

  private baseUrl(): string {
    return this.env() === 'prod'
      ? 'https://track.delhivery.com'
      : 'https://staging-express.delhivery.com';
  }

  private apiToken(): string | undefined {
    const env = this.env();
    const token =
      env === 'prod'
        ? this.config.get<string>('DELHIVERY_API_TOKEN_PROD')
        : this.config.get<string>('DELHIVERY_API_TOKEN_STAGING');
    return token?.trim() || undefined;
  }

  private clientName(): string | undefined {
    return this.config.get<string>('DELHIVERY_CLIENT_NAME')?.trim() || undefined;
  }

  private pickupLocationName(): string | undefined {
    return (
      this.config.get<string>('DELHIVERY_PICKUP_LOCATION')?.trim() || undefined
    );
  }

  private authHeaders(): Record<string, string> {
    const token = this.apiToken();
    if (!token) {
      throw new BadRequestException('Delhivery is not configured');
    }
    return { Authorization: `Token ${token}` };
  }

  /**
   * Same-day / express shipping cost estimate (Delhivery invoice charges API).
   * Returns null when API credentials are not set (checkout still allowed).
   */
  async calculateShippingCost(
    params: DelhiveryShippingCostParams,
  ): Promise<DelhiveryShippingCostResult | null> {
    if (!this.isConfigured()) return null;

    const url = new URL(`${this.baseUrl()}/api/kinko/v1/invoice/charges/.json`);
    url.searchParams.set('md', 'E');
    url.searchParams.set('ss', 'Delivered');
    url.searchParams.set('pt', params.paymentMode ?? 'Pre-paid');
    url.searchParams.set('o_pin', params.originPin);
    url.searchParams.set('d_pin', params.destinationPin);
    url.searchParams.set('cgm', String(Math.max(1, params.weightGrams)));

    try {
      const res = await firstValueFrom(
        this.http.get(url.toString(), { headers: this.authHeaders() }),
      );
      const data = res.data as Record<string, unknown>;
      const total =
        Number(data?.total_amount) ||
        Number((data?.[0] as Record<string, unknown>)?.total_amount) ||
        Number((data?.[0] as Record<string, unknown>)?.charge) ||
        0;
      const fee = Number.isFinite(total) && total >= 0 ? total : 0;
      return { fee, currency: 'INR', raw: data };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Delhivery rate quote failed: ${msg}`);
      return { fee: 0, currency: 'INR', raw: { error: msg } };
    }
  }

  async checkPincodeServiceable(pin: string): Promise<boolean | null> {
    if (!this.isConfigured()) return null;
    const url = `${this.baseUrl()}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pin)}`;
    try {
      const res = await firstValueFrom(
        this.http.get(url, { headers: this.authHeaders() }),
      );
      const list = (res.data as { delivery_codes?: unknown[] })?.delivery_codes;
      return Array.isArray(list) && list.length > 0;
    } catch {
      return null;
    }
  }

  async createShipment(
    params: DelhiveryCreateShipmentParams,
  ): Promise<DelhiveryCreateShipmentResult | null> {
    if (!this.isConfigured()) return null;

    const client = this.clientName();
    const pickup = params.pickupLocationName || this.pickupLocationName();
    if (!client || !pickup) {
      this.logger.warn(
        'Delhivery createShipment skipped: DELHIVERY_CLIENT_NAME or pickup location missing',
      );
      return null;
    }

    const payload = {
      shipments: [
        {
          name: params.consigneeName,
          add: params.consigneeAddress,
          pin: params.destinationPin,
          phone: params.consigneePhone,
          order: params.orderId,
          payment_mode: params.paymentMode ?? 'Pre-paid',
          weight: String(Math.max(0.05, params.weightGrams / 1000)),
          quantity: 1,
        },
      ],
      pickup_location: { name: pickup },
    };

    const body = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const url = `${this.baseUrl()}/api/cmu/create.json`;

    try {
      const res = await firstValueFrom(
        this.http.post(url, body, {
          headers: {
            ...this.authHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
      const data = res.data as Record<string, unknown>;
      const packages = (data?.packages as unknown[]) ?? [];
      const first = (packages[0] as Record<string, unknown>) ?? {};
      const waybill =
        (first?.waybill as string) ??
        (data?.waybill as string) ??
        null;
      return {
        waybill: waybill ? String(waybill) : null,
        trackingUrl: waybill
          ? `https://www.delhivery.com/track/package/${waybill}`
          : null,
        status: (first?.status as string) ?? 'Created',
        raw: data,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Delhivery createShipment failed: ${msg}`);
      return null;
    }
  }

  async trackShipment(waybill: string): Promise<{ status: string | null; raw: unknown } | null> {
    if (!this.isConfigured() || !waybill) return null;
    const url = `${this.baseUrl()}/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`;
    try {
      const res = await firstValueFrom(
        this.http.get(url, { headers: this.authHeaders() }),
      );
      const data = res.data as Record<string, unknown>;
      const shipmentData = (data?.ShipmentData as unknown[]) ?? [];
      const first = (shipmentData[0] as Record<string, unknown>)?.Shipment as Record<string, unknown>;
      const status =
        (first?.Status as string) ??
        (first?.status as string) ??
        null;
      return { status, raw: data };
    } catch {
      return null;
    }
  }
}
