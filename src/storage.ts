import { LocalStorage } from "@raycast/api";
import type { ManagedService } from "./types";

const SERVICES_KEY = "raycast-ai-server-services";

export async function readServices(): Promise<ManagedService[]> {
  const raw = await LocalStorage.getItem<string>(SERVICES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ManagedService[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeServices(services: ManagedService[]): Promise<void> {
  await LocalStorage.setItem(SERVICES_KEY, JSON.stringify(services));
}

export async function upsertService(next: ManagedService): Promise<void> {
  const current = await readServices();
  const idx = current.findIndex((service) => service.id === next.id);
  if (idx === -1) {
    current.push(next);
  } else {
    current[idx] = next;
  }
  await writeServices(current);
}

export async function patchService(
  id: string,
  patch: Partial<ManagedService>,
): Promise<void> {
  const current = await readServices();
  const idx = current.findIndex((service) => service.id === id);
  if (idx === -1) return;
  current[idx] = { ...current[idx], ...patch };
  await writeServices(current);
}
