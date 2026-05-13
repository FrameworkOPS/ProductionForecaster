import axios from 'axios';
import { API_BASE_URL } from '../utils/apiConfig';

const base = `${API_BASE_URL}/api/estimating`;

function authHeaders() {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface EstimateProject {
  id: string;
  name: string;
  project_address: string;
  gc_name: string;
  bid_date: string;
  project_type: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
  doc_count?: number;
  line_item_count?: number;
  total_bid?: number;
}

export interface EstimateDetail extends EstimateProject {
  documents: EstimateDocument[];
  specs: EstimateSpec[];
  lineItems: EstimateLineItem[];
  concerns: EstimateConcern[];
  takeoffs: EstimateTakeoff[];
}

export interface EstimateDocument {
  id: string;
  project_id: string;
  file_name: string;
  doc_type: string;
  parsed: boolean;
  parsed_at: string;
  created_at: string;
}

export interface EstimateSpec {
  id: string;
  section: string;
  spec_type: string;
  description: string;
  value: string;
}

export interface EstimateLineItem {
  id: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  waste_factor: number;
  notes: string;
  sort_order: number;
  material_key?: string;
  price_flagged?: boolean;
}

export interface EstimateConcern {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface EstimateTakeoff {
  id: string;
  label: string;
  value: number;
  unit: string;
  category: string;
  source: string;
}

export const listProjects = async (): Promise<EstimateProject[]> => {
  const res = await axios.get(base, { headers: authHeaders() });
  return res.data.data;
};

export const getProject = async (id: string): Promise<EstimateDetail> => {
  const res = await axios.get(`${base}/${id}`, { headers: authHeaders() });
  return res.data.data;
};

export const createProject = async (data: Partial<EstimateProject>): Promise<EstimateProject> => {
  const res = await axios.post(base, data, { headers: authHeaders() });
  return res.data.data;
};

export const updateProject = async (id: string, data: Partial<EstimateProject>): Promise<EstimateProject> => {
  const res = await axios.put(`${base}/${id}`, data, { headers: authHeaders() });
  return res.data.data;
};

export const deleteProject = async (id: string): Promise<void> => {
  await axios.delete(`${base}/${id}`, { headers: authHeaders() });
};

// ── Documents ─────────────────────────────────────────────────────────────────

export const uploadDocument = async (projectId: string, file: File, docType: string): Promise<EstimateDocument> => {
  const form = new FormData();
  form.append('file', file);
  form.append('doc_type', docType);
  const res = await axios.post(`${base}/${projectId}/documents`, form, {
    headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
};

export const parseDocument = async (projectId: string, docId: string): Promise<any> => {
  const res = await axios.post(`${base}/${projectId}/documents/${docId}/parse`, {}, { headers: authHeaders() });
  return res.data.data;
};

export const deleteDocument = async (projectId: string, docId: string): Promise<void> => {
  await axios.delete(`${base}/${projectId}/documents/${docId}`, { headers: authHeaders() });
};

// ── Line Items ────────────────────────────────────────────────────────────────

export const createLineItem = async (projectId: string, data: Partial<EstimateLineItem>): Promise<EstimateLineItem> => {
  const res = await axios.post(`${base}/${projectId}/line-items`, data, { headers: authHeaders() });
  return res.data.data;
};

export const updateLineItem = async (projectId: string, itemId: string, data: Partial<EstimateLineItem>): Promise<EstimateLineItem> => {
  const res = await axios.put(`${base}/${projectId}/line-items/${itemId}`, data, { headers: authHeaders() });
  return res.data.data;
};

export const deleteLineItem = async (projectId: string, itemId: string): Promise<void> => {
  await axios.delete(`${base}/${projectId}/line-items/${itemId}`, { headers: authHeaders() });
};

// ── Specs ────────────────────────────────────────────────────────────────────

export const createSpec = async (projectId: string, data: Partial<EstimateSpec>): Promise<EstimateSpec> => {
  const res = await axios.post(`${base}/${projectId}/specs`, data, { headers: authHeaders() });
  return res.data.data;
};

export const deleteSpec = async (projectId: string, specId: string): Promise<void> => {
  await axios.delete(`${base}/${projectId}/specs/${specId}`, { headers: authHeaders() });
};

// ── Concerns ─────────────────────────────────────────────────────────────────

export const createConcern = async (projectId: string, data: Partial<EstimateConcern>): Promise<EstimateConcern> => {
  const res = await axios.post(`${base}/${projectId}/concerns`, data, { headers: authHeaders() });
  return res.data.data;
};

export const deleteConcern = async (projectId: string, concernId: string): Promise<void> => {
  await axios.delete(`${base}/${projectId}/concerns/${concernId}`, { headers: authHeaders() });
};

// ── Takeoffs ──────────────────────────────────────────────────────────────────

export const createTakeoff = async (projectId: string, data: Partial<EstimateTakeoff>): Promise<EstimateTakeoff> => {
  const res = await axios.post(`${base}/${projectId}/takeoffs`, data, { headers: authHeaders() });
  return res.data.data;
};

export const updateTakeoff = async (projectId: string, takeoffId: string, data: Partial<EstimateTakeoff>): Promise<EstimateTakeoff> => {
  const res = await axios.put(`${base}/${projectId}/takeoffs/${takeoffId}`, data, { headers: authHeaders() });
  return res.data.data;
};

export const deleteTakeoff = async (projectId: string, takeoffId: string): Promise<void> => {
  await axios.delete(`${base}/${projectId}/takeoffs/${takeoffId}`, { headers: authHeaders() });
};

// ── Export ────────────────────────────────────────────────────────────────────

export const exportBidPdf = (projectId: string): void => {
  const token = localStorage.getItem('token');
  const url = `${base}/${projectId}/export/pdf`;
  const a = document.createElement('a');
  a.href = url + `?token=${token}`;
  a.target = '_blank';
  // Use fetch with auth header instead
  fetch(url, { headers: authHeaders() })
    .then((res) => res.blob())
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.download = `bid-package.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    });
};
