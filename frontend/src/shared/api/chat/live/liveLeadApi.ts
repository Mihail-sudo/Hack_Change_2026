import { apiClient } from "@/shared/api/apiClient";
import type { LeadApi } from "../leadApi";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

type LeadResponse = {
  id: number;
  status: string;
  created_at: string;
};

export function createLiveLeadApi(): LeadApi {
  return {
    mode: "live",

    async submitLead(request, signal) {
      const response = await apiClient<LeadResponse>(`${API_BASE}/leads`, {
        method: "POST",
        body: JSON.stringify({
          question: request.summary || request.need,
          name: request.fullName,
          contact: request.phone,
          contact_type: "phone",
        }),
        signal,
      });
      return { leadId: String(response.id), success: true };
    },
  };
}
