import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider, type createBrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';

// Requests are not retried: a failed request should show its error at once, and the
// user can press Refresh. Data is not refetched just because the tab regained focus.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

export default function App({ router }: { router: ReturnType<typeof createBrowserRouter> }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
