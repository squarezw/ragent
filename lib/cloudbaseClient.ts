// The SDK is only needed on the verification-code tab, so it is fetched on demand instead of in the main bundle.
export type VerificationInfo = { verification_id: string; is_user: boolean };
// SDK failures are plain objects; surface whichever text field they carry instead of an empty alert.
export const describeCloudbaseError = (error: unknown) => {
  const e = error as { message?: string; error_description?: string; msg?: string } | null;
  return e?.message || e?.error_description || e?.msg || "验证码服务暂时不可用，请稍后重试。";
};
export type CloudbaseAuth = {
  getVerification(params: { email?: string; phone_number?: string }): Promise<VerificationInfo>;
  // Both sign-in calls verify the code, then register a first-time user or sign in an existing one.
  signInWithEmail(params: {
    email: string;
    verificationCode: string;
    verificationInfo: VerificationInfo;
  }): Promise<unknown>;
  signInWithSms(params: {
    phoneNum: string;
    verificationCode: string;
    verificationInfo: VerificationInfo;
  }): Promise<unknown>;
  getAccessToken(): Promise<{ accessToken: string }>;
  signOut(): Promise<unknown>;
};
let cached: { env: string; client: Promise<CloudbaseAuth> } | undefined;
// The environment id comes from /api/auth/methods at runtime rather than from a build-time variable, so one build serves every deployment.
export function loadCloudbaseAuth(env: string | undefined): Promise<CloudbaseAuth> {
  if (!env) return Promise.reject(new Error("未配置验证码登录。"));
  if (cached?.env !== env) {
    // Newer environments register email / SMS providers on the gateway endpoint only; the SDK's legacy default returns "provider not found".
    cached = {
      env,
      client: import("@cloudbase/js-sdk").then(
        (module) =>
          module.default
            .init({ env, endPointMode: "GATEWAY" })
            .auth({ persistence: "local" }) as unknown as CloudbaseAuth
      ),
    };
  }
  return cached.client;
}
