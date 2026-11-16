export type OAuthClientRow = {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none" | "client_secret_post" | "client_secret_basic";
  created_at: string;
  revoked_at: string | null;
};

export type OAuthAuthCodeRow = {
  id: string;
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  code_challenge_method: "S256";
  resource: string;
  grant_token_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export type OAuthAccessTokenRow = {
  id: string;
  token_hash: string;
  grant_token_id: string;
  client_id: string;
  scopes: string[];
  resource: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type OAuthRefreshTokenRow = {
  id: string;
  token_hash: string;
  grant_token_id: string;
  client_id: string;
  scopes: string[];
  resource: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by_id: string | null;
};

export type OAuthGrantTokenRow = {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  overlap_until: string | null;
  token_hash: string;
  auth_kind: "oauth";
  oauth_client_id: string | null;
  oauth_client_name: string | null;
  approved_by: string | null;
  helpers_skip_xos_approval?: boolean;
  auto_approve?: boolean;
};

export type RegisteredClientInput = {
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
};

export type TokenSuccess = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "server_error"
  | "access_denied"
  | "login_required";

export type OAuthErrorBody = {
  error: OAuthErrorCode;
  error_description?: string;
};

export type AuthorizeUser = {
  userId: string;
  displayName: string;
  scopes: string[];
};
