import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  loginWithPassword,
  logoutSession,
  restoreSession,
} from '../services/auth-service.ts'
import type { AuthSession, LoginInput } from '../types/auth.ts'

export function useLoginMutation(): UseMutationResult<AuthSession, Error, LoginInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: loginWithPassword,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useLogoutMutation(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: logoutSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useRestoreSessionQuery(enabled: boolean): UseQueryResult<AuthSession, Error> {
  return useQuery({
    enabled,
    queryKey: ['auth', 'restore-session'],
    queryFn: restoreSession,
    retry: false,
  })
}
