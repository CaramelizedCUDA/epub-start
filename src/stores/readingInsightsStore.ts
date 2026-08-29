import { create } from 'zustand';
import {
  getLibraryReadingOverview,
  getReadingFootprint,
} from '../lib/tauri';
import type {
  LibraryReadingOverview,
  ReadingFootprint,
  ReadingFootprintScope,
  ReadingOverviewPeriod,
} from '../types/models';

interface ReadingInsightsState {
  overview: LibraryReadingOverview | null;
  overviewPeriod: ReadingOverviewPeriod;
  overviewLoading: boolean;
  overviewError: string | null;
  footprint: ReadingFootprint | null;
  footprintScope: ReadingFootprintScope | null;
  footprintLoading: boolean;
  footprintError: string | null;
  loadOverview: (period: ReadingOverviewPeriod) => Promise<void>;
  loadFootprint: (scope: ReadingFootprintScope) => Promise<void>;
  clearOverviewError: () => void;
  clearFootprintError: () => void;
}

let overviewRequestId = 0;
let footprintRequestId = 0;

export const useReadingInsightsStore = create<ReadingInsightsState>((set) => ({
  overview: null,
  overviewPeriod: 'week',
  overviewLoading: false,
  overviewError: null,
  footprint: null,
  footprintScope: null,
  footprintLoading: false,
  footprintError: null,

  loadOverview: async (period) => {
    const requestId = ++overviewRequestId;
    set({ overviewPeriod: period, overviewLoading: true, overviewError: null });
    try {
      const overview = await getLibraryReadingOverview({
        period,
        anchorLocalDate: currentLocalDate(),
        utcOffsetMinutes: currentUtcOffsetMinutes(),
      });
      if (requestId !== overviewRequestId) return;
      set({ overview, overviewLoading: false });
    } catch (err) {
      if (requestId !== overviewRequestId) return;
      set({ overviewLoading: false, overviewError: userFacingError(err) });
    }
  },

  loadFootprint: async (scope) => {
    const requestId = ++footprintRequestId;
    set({ footprintScope: scope, footprintLoading: true, footprintError: null });
    try {
      const footprint = await getReadingFootprint({ scope });
      if (requestId !== footprintRequestId) return;
      set({ footprint, footprintLoading: false });
    } catch (err) {
      if (requestId !== footprintRequestId) return;
      set({ footprintLoading: false, footprintError: userFacingError(err) });
    }
  },

  clearOverviewError: () => set({ overviewError: null }),
  clearFootprintError: () => set({ footprintError: null }),
}));

function currentLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export function currentLocalYear(): number {
  return new Date().getFullYear();
}

function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('INTERNAL_ERROR:')) {
    return '阅读记录暂时不可用，请重试。';
  }
  return message;
}
