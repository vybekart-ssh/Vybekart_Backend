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
  DelhiveryPickupRequestResult,
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

  /** Next pickup slot date/time in IST (Delhivery expects YYYY-MM-DD + hh:mm:ss). */
  private defaultPickupSchedule(): { pickupDate: string; pickupTime: string } {
    const pickupTime =
      this.config.get<string>('DELHIVERY_PICKUP_TIME')?.trim() || '15:00:00';
    const pickupDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    }).format(new Date());
    return { pickupDate, pickupTime };
  }

  private autoPickupRequestEnabled(): boolean {
    const raw = this.config.get<string>('DELHIVERY_AUTO_PICKUP_REQUEST');
    if (raw === undefined || raw === '') return true;
    return ['true', '1', 'yes'].includes(raw.trim().toLowerCase());
  }

  /**
   * Schedules warehouse pickup after shipment manifestation (Delhivery step 6).
   * Optional in Delhivery docs but required for many accounts to dispatch FE.
   */
  async createPickupRequest(opts: {
    pickupLocationName: string;
    expectedPackageCount?: number;
    pickupDate?: string;
    pickupTime?: string;
  }): Promise<DelhiveryPickupRequestResult | null> {
    if (!this.isConfigured()) return null;

    const location = opts.pickupLocationName || this.pickupLocationName();
    if (!location) {
      this.logger.warn('Delhivery pickup skipped: no pickup location name');
      return null;
    }

    const schedule = this.defaultPickupSchedule();
    const body = {
      pickup_location: location,
      pickup_date: opts.pickupDate ?? schedule.pickupDate,
      pickup_time: opts.pickupTime ?? schedule.pickupTime,
      expected_package_count: Math.max(1, opts.expectedPackageCount ?? 1),
    };

    const url = `${this.baseUrl()}/fm/request/new/`;
    try {
      const res = await firstValueFrom(
        this.http.post(url, body, {
          headers: {
            ...this.authHeaders(),
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }),
      );
      const data = res.data as Record<string, unknown>;
      const pickupId =
        (data?.pickup_id as string) ??
        (data?.pickupId as string) ??
        (data?.id as string) ??
        null;
      return { pickupId: pickupId ? String(pickupId) : null, raw: data };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Delhivery createPickupRequest failed: ${msg}`);
      return { pickupId: null, raw: { error: msg } };
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
      return {
        waybill: null,
        trackingUrl: null,
        status: null,
        raw: {
          error: !client
            ? 'DELHIVERY_CLIENT_NAME is not set on the server'
            : 'Delhivery pickup location name is missing. Set DELHIVERY_PICKUP_LOCATION to the exact warehouse name registered in Delhivery.',
        },
      };
    }

    const shipment: Record<string, unknown> = {
      name: params.consigneeName,
      add: params.consigneeAddress,
      pin: params.destinationPin,
      phone: params.consigneePhone,
      order: params.orderId,
      payment_mode: params.paymentMode ?? 'Pre-paid',
      weight: String(Math.max(0.05, params.weightGrams / 1000)),
      quantity: 1,
    };
    if (params.shippingMode === 'Express') {
      shipment.shipping_mode = 'Express';
      shipment.pt = 'Pre-paid';
    }
    const payload = {
      shipments: [shipment],
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
      const packageStatus = String(first?.status ?? data?.status ?? '').trim();
      const waybillRaw =
        (first?.waybill as string) ??
        (data?.waybill as string) ??
        null;
      const waybill =
        waybillRaw && String(waybillRaw).trim() && packageStatus.toLowerCase() !== 'fail'
          ? String(waybillRaw).trim()
          : null;

      if (!waybill) {
        const remarks = this.extractPackageRemarks(first, data);
        this.logger.warn(
          `Delhivery createShipment rejected pickup=${pickup} status=${packageStatus || 'n/a'} remarks=${remarks}`,
        );
        return {
          waybill: null,
          trackingUrl: null,
          status: packageStatus || 'Fail',
          raw: {
            ...(typeof data === 'object' && data !== null ? data : {}),
            error: remarks,
            pickupLocationUsed: pickup,
          },
        };
      }

      const result: DelhiveryCreateShipmentResult = {
        waybill,
        trackingUrl: `https://www.delhivery.com/track/package/${waybill}`,
        status: packageStatus || 'Created',
        raw: data,
      };

      if (result.waybill && this.autoPickupRequestEnabled()) {
        const pickupReq = await this.createPickupRequest({
          pickupLocationName: pickup,
          expectedPackageCount: 1,
        });
        result.pickupRequestId = pickupReq?.pickupId ?? null;
        if (!pickupReq?.pickupId) {
          this.logger.warn(
            `Shipment ${result.waybill} created but pickup request did not return an id`,
          );
        }
      }

      return result;
    } catch (e: unknown) {
      const axiosData =
        e &&
        typeof e === 'object' &&
        'response' in e &&
        (e as { response?: { data?: unknown } }).response?.data;
      const remarks =
        this.extractPackageRemarks(
          {},
          typeof axiosData === 'object' && axiosData !== null
            ? (axiosData as Record<string, unknown>)
            : {},
        ) || (e instanceof Error ? e.message : String(e));
      this.logger.warn(`Delhivery createShipment failed: ${remarks}`);
      return {
        waybill: null,
        trackingUrl: null,
        status: null,
        raw: { error: remarks, pickupLocationUsed: pickup, axiosData },
      };
    }
  }

  /** Pull human-readable Fail remarks from Delhivery CMU / packages payload. */
  private extractPackageRemarks(
    first: Record<string, unknown>,
    data: Record<string, unknown>,
  ): string {
    const candidates: unknown[] = [
      first?.remarks,
      first?.remark,
      first?.error,
      first?.message,
      data?.rmk,
      data?.remarks,
      data?.remark,
      data?.error,
      data?.message,
      data?.Error,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
      if (Array.isArray(c) && c.length > 0) {
        const joined = c
          .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
          .filter(Boolean)
          .join('; ');
        if (joined) return joined;
      }
    }
    try {
      const slice = JSON.stringify(first?.status ? first : data).slice(0, 280);
      return slice && slice !== '{}' ? slice : 'no waybill returned';
    } catch {
      return 'no waybill returned';
    }
  }

  /** Prefer Delhivery remarks / error over dumping the full raw payload. */
  formatCreateShipmentFailure(raw: unknown): string {
    if (!raw) return 'no waybill returned';
    if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 280);
    if (typeof raw !== 'object') return 'no waybill returned';
    const obj = raw as Record<string, unknown>;
    const direct = obj.error ?? obj.message ?? obj.remarks ?? obj.remark ?? obj.rmk;
    if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 280);
    if (Array.isArray(direct) && direct.length > 0) {
      return direct
        .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
        .filter(Boolean)
        .join('; ')
        .slice(0, 280);
    }
    const packages = obj.packages;
    if (Array.isArray(packages) && packages[0] && typeof packages[0] === 'object') {
      const first = packages[0] as Record<string, unknown>;
      const remarks = first.remarks ?? first.remark ?? first.error ?? first.message;
      if (typeof remarks === 'string' && remarks.trim()) return remarks.trim().slice(0, 280);
      if (Array.isArray(remarks) && remarks.length > 0) {
        return remarks
          .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
          .filter(Boolean)
          .join('; ')
          .slice(0, 280);
      }
    }
    try {
      return JSON.stringify(obj).slice(0, 280);
    } catch {
      return 'no waybill returned';
    }
  }

  /** Admin / health: verify token + optional pincode without creating shipments. */
  async getIntegrationStatus(testPin?: string): Promise<{
    configured: boolean;
    env: DelhiveryEnv;
    baseUrl: string;
    hasClientName: boolean;
    hasPickupLocation: boolean;
    autoPickupRequest: boolean;
    pincodeTest?: { pin: string; serviceable: boolean | null };
    quoteTest?: DelhiveryShippingCostResult | null;
  }> {
    const env = this.env();
    const status = {
      configured: this.isConfigured(),
      env,
      baseUrl: this.baseUrl(),
      hasClientName: !!this.clientName(),
      hasPickupLocation: !!this.pickupLocationName(),
      autoPickupRequest: this.autoPickupRequestEnabled(),
    };

    const pin = testPin?.trim();
    if (!pin || pin.length !== 6) {
      return status;
    }

    const serviceable = await this.checkPincodeServiceable(pin);
    const quote = await this.calculateShippingCost({
      originPin: pin,
      destinationPin: pin,
      weightGrams: 500,
    });

    return {
      ...status,
      pincodeTest: { pin, serviceable },
      quoteTest: quote,
    };
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
