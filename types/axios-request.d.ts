import "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    /** The caller displays a localized error instead of the global toast. */
    suppressErrorToast?: boolean;
  }
}
