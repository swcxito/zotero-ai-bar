import { PROVIDERS } from "./constants";

export interface ProviderInfo {
  key: string;
  baseUrl: string;
  models?: string[];
}

export interface UserProviderModel {
  id?: string; // 模型唯一 ID (UUID)
  name: string; // 模型名称
  enable?: boolean; // 是否启用
  providerId?: string; // 所属 Provider ID
}

export interface UserProvider {
  id: string; // Provider 唯一 ID (UUID)
  key?: keyof typeof PROVIDERS; // 如果是预设，则有此字段，对应 defaultProvidersMap 的 key
  name: string; // Provider 名称 (可由用户修改)
  baseUrl?: string; // API Base URL
  apiKey?: string; // API Key
  models?: UserProviderModel[]; // 模型列表
  isCustom: boolean; // 是否为自定义 Provider
}

export interface UserProviderConfig extends UserProvider {
  name: string; // Provider 名称 (可由用户修改)
  baseUrl: string; // API Base URL
  apiKey: string; // API Key
  models: UserProviderModel[]; // 模型列表
}
