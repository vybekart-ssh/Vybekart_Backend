export type BorzoEnv = 'test' | 'prod';

export interface BorzoContactPerson {
  phone: string;
  name?: string | null;
}

export interface BorzoPackageItem {
  ware_code?: string | null;
  description?: string | null;
  items_count?: number;
  item_payment_amount?: string;
  nomenclature_code?: string | null;
}

export interface BorzoPoint {
  address: string;
  contact_person: BorzoContactPerson;
  client_order_id?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  note?: string | null;
  apartment_number?: string | null;
  floor_number?: string | null;
  building_number?: string | null;
  entrance_number?: string | null;
  intercom_code?: string | null;
  invisible_mile_navigation_instructions?: string | null;
  packages?: BorzoPackageItem[];
  taking_amount?: string;
  buyout_amount?: string;
  is_cod_cash_voucher_required?: boolean;
}

export interface BorzoCalculateOrderRequest {
  type?: 'standard' | 'endofday';
  matter: string;
  points: BorzoPoint[];
  total_weight_kg?: number;
  is_client_notification_enabled?: boolean;
  is_contact_person_notification_enabled?: boolean;
  is_route_optimizer_enabled?: boolean;
  payment_method?: string | null;
  bank_card_id?: number | null;
}

export interface BorzoCreateOrderRequest extends BorzoCalculateOrderRequest {
  type?: 'standard' | 'endofday';
}

export interface BorzoErrorResponse {
  is_successful: false;
  errors?: string[];
  parameter_errors?: unknown;
}

export interface BorzoOkResponse<T> {
  is_successful: true;
  order?: T;
  warnings?: string[];
  parameter_warnings?: unknown;
}

