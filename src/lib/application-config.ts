export const queryLimits = {
  pageSize: 25,
  maximumPage: 100_000,
  lookupRows: 1_000,
  detailRows: 100,
  dashboardRows: 8,
} as const;

export const attachmentFallbackLimits = {
  maxFileBytes: 3 * 1024 * 1024,
  maxAttachmentsPerOrder: 20,
} as const;

export const fieldLimits = {
  search: 100,
  email: 254,
  password: 200,
  title: 500,
  observation: 5_000,
  policeReport: 200,
  catalogName: 500,
  catalogValue: 2_000,
  unitName: 300,
  unitType: 200,
  unitAddress: 1_000,
  coordinates: 100,
  profileName: 200,
  message: 5_000,
} as const;
