import { AxiosError } from "axios";

export function getErrorMessage(e: unknown): string {
  if (e instanceof AxiosError) {
    return e.response?.data?.error?.message ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
