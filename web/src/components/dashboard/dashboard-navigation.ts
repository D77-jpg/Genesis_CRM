import { useNavigate } from 'react-router-dom';
import { useCustomerStore, type CustomerSortField } from '@/store/customer.store';
import { useLetterStore } from '@/store/letter.store';
import { ROUTES } from '@/constants';
import type { LetterStatus } from '@/types';

type CustomerFilters = Parameters<ReturnType<typeof useCustomerStore.getState>['setFilters']>[0];

/** Dashboard shortcuts start a fresh query instead of inheriting hidden list filters. */
export function useDashboardNavigation() {
  const navigate = useNavigate();
  return {
    openCustomers(filters: CustomerFilters = {}, sortBy?: CustomerSortField) {
      const store = useCustomerStore.getState();
      store.resetFilters();
      store.setFilters(filters);
      if (sortBy) store.setSorting(sortBy);
      navigate(ROUTES.customers);
    },
    openLetters(status: LetterStatus | 'all' = 'all') {
      const store = useLetterStore.getState();
      store.resetFilters();
      store.setFilters({ status });
      navigate(ROUTES.letters);
    },
  };
}
