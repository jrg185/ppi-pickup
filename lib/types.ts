export type Impound = {
  id: string;
  plate: string;
  state: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  color: string;
  lotName: string;
  lotAddress: string;
  towedFrom: string;
  towedAt: string;
  fees: {
    towing: number;
    storageDaily: number;
    admin: number;
  };
  status: "awaiting" | "released";
};

export type Release = {
  code: string;
  impoundId: string;
  customerName: string;
  customerPhone: string;
  amountPaidCents: number;
  paidAt: string;
  issuedAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
  stripeSessionId: string | null;
  demo: boolean;
};

export type FeeBreakdown = {
  towing: number;
  storage: number;
  admin: number;
  total: number;
  storageDays: number;
};
