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
}
