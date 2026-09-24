import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchTrends } from '../api';

export const trendKeys = {
  range: (days: number, tz: string) => ['tickets', 'trends', days, tz] as const,
};

// The last `days` days. The previous range stays on screen while the next one loads, so
// switching between 7, 30 and 90 days does not flash an empty chart.
export function useTrends(days: number, tz: string) {
  return useQuery({
    queryKey: trendKeys.range(days, tz),
    queryFn: ({ signal }) => fetchTrends({ days, tz }, { signal }),
    placeholderData: keepPreviousData,
  });
}
