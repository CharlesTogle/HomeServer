import type { AuthSession, LoginInput } from "../types/auth.ts";
import { generateClientId } from "../utils/random-id.ts";

async function wait(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function getDisplayName(email: string): string {
  const [namePart] = email.split("@");

  return namePart
    .split(/[.\-_]/g)
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export async function loginWithPassword(
  input: LoginInput,
): Promise<AuthSession> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPassword = input.password.trim();

  if (normalizedEmail.length === 0) {
    throw new Error("Enter your email address.");
  }

  if (normalizedPassword.length < 4) {
    throw new Error("Use at least four characters for the password.");
  }

  await wait(220);

  return {
    accessToken: `mock-access-token-${generateClientId()}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    user: {
      id: "user-demo-admin",
      name: getDisplayName(normalizedEmail) || "Private Admin",
      email: normalizedEmail,
    },
  };
}

export async function logoutSession(): Promise<void> {
  await wait(160);
}
