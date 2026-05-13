import axios from 'axios';
import { API_BASE_URL } from '../utils/apiConfig';

const base = `${API_BASE_URL}/api/prices`;

function authHeaders() {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
}

export type PriceKind = 'material' | 'labor';

export interface Price {
  id: string;
  material_key: string;
  category: string;
  description: string;
  unit: string;
  unit_cost: number;
  vendor?: string;
  notes?: string;
  last_updated: string;
}

export const listPrices = async (kind: PriceKind): Promise<Price[]> => {
  const res = await axios.get(`${base}?kind=${kind}`, { headers: authHeaders() });
  return res.data.data;
};

export const createPrice = async (kind: PriceKind, data: Partial<Price>): Promise<Price> => {
  const res = await axios.post(base, { ...data, kind }, { headers: authHeaders() });
  return res.data.data;
};

export const updatePrice = async (kind: PriceKind, id: string, data: Partial<Price>): Promise<Price> => {
  const res = await axios.put(`${base}/${id}`, { ...data, kind }, { headers: authHeaders() });
  return res.data.data;
};

export const deletePrice = async (kind: PriceKind, id: string): Promise<void> => {
  await axios.delete(`${base}/${id}?kind=${kind}`, { headers: authHeaders() });
};

export const repriceProject = async (projectId: string): Promise<{ updated: number; stillFlagged: number }> => {
  const res = await axios.post(`${base}/reprice/${projectId}`, {}, { headers: authHeaders() });
  return res.data.data;
};
