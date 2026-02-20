export type ServiceStatus = "starting" | "running" | "stopped" | "error";

export interface ManagedService {
  id: string;
  modelKey: string;
  modelValue: string;
  port: number;
  status: ServiceStatus;
  startedAt: number;
  lastError?: string;
}
