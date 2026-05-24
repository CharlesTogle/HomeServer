import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { loginWithPassword, logoutSession } from '../services/mock-auth-service.ts'
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
