/**
 * Type definitions for i18n namespaces
 * Auto-generated based on messages structure
 */

// Makes this file a module so `declare module` below becomes an augmentation
// (not an ambient declaration that shadows all next-intl exports).
export {};

type Messages = typeof import("../messages/en/common.json") & {
  common: typeof import("../messages/en/common.json");
  navigation: typeof import("../messages/en/navigation.json");
  login: typeof import("../messages/en/login.json");
  dashboard: typeof import("../messages/en/dashboard.json");
  apps: typeof import("../messages/en/apps.json");
  datasets: typeof import("../messages/en/datasets.json");
  settings: typeof import("../messages/en/settings.json");
  errors: typeof import("../messages/en/errors.json");
  success: typeof import("../messages/en/success.json");
  chat: typeof import("../messages/en/chat.json");
  knowledge: typeof import("../messages/en/knowledge.json");
  organization: typeof import("../messages/en/organization.json");
  chatSessions: typeof import("../messages/en/chatSessions.json");
  user: typeof import("../messages/en/user.json");
  sop: typeof import("../messages/en/sop.json");
  products: typeof import("../messages/en/products.json");
  search: typeof import("../messages/en/search.json");
  graph: typeof import("../messages/en/graph.json");
  monitoring: typeof import("../messages/en/monitoring.json");
  demo: typeof import("../messages/en/demo.json");
  about: typeof import("../messages/en/about.json");
  prompts: typeof import("../messages/en/prompts.json");
  feedback: typeof import("../messages/en/feedback.json");
  systemSettings: typeof import("../messages/en/systemSettings.json");
  password: typeof import("../messages/en/password.json");
  businessTrip: typeof import("../messages/en/businessTrip.json");
  workflow: typeof import("../messages/en/workflow.json");
  tools: typeof import("../messages/en/tools.json");
  processManagement: typeof import("../messages/en/processManagement.json");
  zdObserve: typeof import("../messages/en/zdObserve.json");
};

declare module "next-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
