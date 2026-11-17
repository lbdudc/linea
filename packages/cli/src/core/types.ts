
export interface SplalmMember {
  username: string;
  role: number;
}

export interface SplalmProductSummary {
  _id: string;
  name: string;
  version: string;
  line: string;
  createdAt: string;
  repo: {
    id: number;
    webUrl: string;
  };
}

export interface ProductBasicData {
  name: string;
  version: string;
  createdAt?: string;
  database?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  languages?: string[];
  SRID?: string;
}

export interface ProductSpec {
  basicData: ProductBasicData;
  dataModel?: Record<string, unknown>;
  features?: string[];
  statics?: unknown[];
}

export interface SplalmProductDetail {
  _id: string;
  spec: ProductSpec;
  lineId: string;
  repo: {
    id: number;
    namespaceId: number;
    webUrl: string;
    webIdeUrl: string;
  };
  featureModel: string;
  members: SplalmMember[];
  line: { id: string; name: string };
}

export interface SplalmLine {
  _id: string;
  name: string;
  version: string;
  description: string;
  models: string[];
  repoId: number;
  namespaceId: number;
  webUrl: string;
  webIdeUrl: string;
  members: SplalmMember[];
  products: SplalmProductSummary[];
}

export interface SplalmLineSummary {
  _id: string;
  name: string;
  version: string;
  description?: string;
  webUrl?: string;
}

export interface SplalmLog {
  version: string;
  type: 'info' | 'warning' | 'success' | 'error';
  message: string;
  params?: string[];
  link?: string;
  createdAt: string;
}

export interface ProductConflicts {
  openMRs: number;
  conflictingMRs: number;
}

export interface GenerateResult extends Record<string, unknown> {
  spec?: ProductSpec;
  repo?: SplalmProductDetail['repo'];
  conflicts?: boolean;
  stage?: 'generating' | 'update';
  mergeRequestUrl?: string;
}

export interface LoginResponse {
  token: string;
  user: { userId: string; username: string; hosts?: string[]; activeHost?: string | null };
}

export interface PublicConfig {
  clientId: string;
  redirectUri: string;
  url: string;
  /** Where to log in and what to ask for: the host the server is on (GitLab or GitHub). Older servers say neither. */
  authorizeUrl?: string;
  scope?: string;
  provider?: 'local' | 'gitlab' | 'github';
  /** Every git host that is on, as the server lists them (older servers do not say), and the primary one. */
  hosts?: { id: 'local' | 'gitlab' | 'github'; clientId?: string; url?: string; authorizeUrl?: string; scope?: string; redirectUri?: string }[];
  primary?: 'local' | 'gitlab' | 'github';
}

export interface SplalmNamespace {
  id: number;
  fullPath: string;
  name: string;
}

export interface ReconcileLinesResult {
  created: { id: string; name: string }[];
  skipped: number;
  archived: { id: string; name: string }[];
}

export interface ReconcileProductsResult {
  created: { id: string; name: string; lineName: string }[];
  unlinked: { name: string; reason: string }[];
  skipped: number;
  archived: { id: string; name?: string }[];
}
