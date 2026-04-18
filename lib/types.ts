// lib/types.ts
export type CaseStatus = 'ny' | 'open' | 'waiting' | 'eskalert' | 'closed';
export type CasePriority = 'low' | 'normal' | 'high' | 'critical';
export type MessageType = 'customer' | 'agent' | 'internal';
export type UserRole = 'admin' | 'saksbehandler' | 'senterleder';
export type CaseOutcome = 'approved' | 'partial' | 'rejected' | 'dropped';

export interface Case {
  id: string;
  case_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_type: string | null;
  company: string | null;
  category: string;
  senter: string | null;
  description: string | null;
  desired_resolution: string | null;
  reg_nr: string | null;
  visit_date: string | null;
  order_number: string | null;
  status: CaseStatus;
  priority: CasePriority;
  assigned_to: string | null;
  outcome: CaseOutcome | null;
  cost_estimated: number | null;
  cost_actual: number | null;
  sla_deadline: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Message {
  id: string;
  case_id: string;
  type: MessageType;
  sender_name: string;
  content: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  senter: string | null;
  phone: string | null;
  status: 'active' | 'pending';
}

export interface PendingRegistration {
  id: string;
  full_name: string;
  email: string;
  senter: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  case_id: string;
  uploader_id: string | null;
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  category: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}
