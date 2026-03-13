export const features = {
  useMock: import.meta.env.VITE_USE_MOCK === "true",
  enableManualAdd: import.meta.env.VITE_ENABLE_MANUAL_ADD === "true",
  enableTimeRange: import.meta.env.VITE_ENABLE_TIME_RANGE === "true",
  enableFacet: import.meta.env.VITE_ENABLE_FACET === "true",
  enableTopicSummary: import.meta.env.VITE_ENABLE_TOPIC_SUMMARY === "true",
  enableAnalysis:
    import.meta.env.VITE_ENABLE_ANALYSIS !== "false" &&
    import.meta.env.VITE_USE_MOCK !== "true",
};
