import { features } from "@/config/features";
import type { DashboardProvider } from "./provider";
import { mockProvider } from "./provider-mock";
import { httpProvider } from "./provider-http";

function createHybridProvider(): DashboardProvider {
  return {
    ...httpProvider,
    getTopicSummary: features.enableTopicSummary
      ? mockProvider.getTopicSummary
      : httpProvider.getTopicSummary,
  };
}

export const api: DashboardProvider = features.useMock
  ? mockProvider
  : createHybridProvider();
