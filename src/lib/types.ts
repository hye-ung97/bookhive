export type CycleStatus = "requesting" | "reading" | "closed";

export type Cycle = {
  id: string;
  month: string; // 'YYYY-MM-01'
  status: CycleStatus;
  budget_per_person: number;
  budget_note: string | null;
  request_deadline: string | null;
  journal_deadline: string | null;
  plan_url: string | null; // 회사에 내는 활동 계획서
  report_url: string | null; // 활동 보고서
};

export type RequestStatus = "requested" | "cart" | "ordered" | "delivered" | "cancelled";

export type RequestRow = {
  id: string;
  cycle_id: string;
  member_id: string;
  member_name: string;
  title: string;
  author: string | null;
  isbn: string | null;
  price: number;
  store: "yes24" | "kyobo" | "other";
  url: string | null;
  verified: boolean;
  looked_up_price: number | null;
  bundle_id: string | null;
  purchase_store: "yes24" | "kyobo" | "other" | null;
  expected_arrival: string | null;
  status: RequestStatus;
  created_at: string;
};

export type Budget = {
  cycle_id: string;
  member_id: string;
  budget: number;
  used: number;
  reserved: number;
  remaining: number;
  request_count: number;
};
