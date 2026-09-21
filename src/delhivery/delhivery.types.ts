export type DelhiveryEnv = 'staging' | 'prod';

export interface DelhiveryShippingCostParams {
  originPin: string;
  destinationPin: string;
  weightGrams: number;
  paymentMode?: 'Pre-paid' | 'COD';
}

export interface DelhiveryCreateShipmentParams {
  orderId: string;
  pickupLocationName: string;
  originPin: string;
  destinationPin: string;
  consigneeName: string;
  consigneePhone: string;
  consigneeAddress: string;
  weightGrams: number;
  paymentMode?: 'Pre-paid' | 'COD';
  /** Express / same-day when supported by account */
  shippingMode?: 'Express' | 'Surface';
}

export interface DelhiveryShippingCostResult {
  fee: number;
  currency: string;
  raw: unknown;
}

export interface DelhiveryCreateShipmentResult {
  waybill: string | null;
  trackingUrl: string | null;
  status: string | null;
  raw: unknown;
  pickupRequestId?: string | null;
}

export interface DelhiveryPickupRequestResult {
  pickupId: string | null;
  raw: unknown;
}

/** Payload for Delhivery Client Warehouse Creation API. */
export interface DelhiveryCreateWarehouseParams {
  /** Unique warehouse name used later as pickup_location.name (no underscores). */
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  pin: string;
  country?: string;
  registeredName?: string;
  returnAddress?: string;
  returnPin?: string;
  returnCity?: string;
  returnState?: string;
  returnCountry?: string;
}

export interface DelhiveryEditWarehouseParams {
  name: string;
  pin: string;
  phone?: string;
  address?: string;
  registeredName?: string;
}

export interface DelhiveryWarehouseResult {
  success: boolean;
  name: string | null;
  error: string | null;
  raw: unknown;
}
