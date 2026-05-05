import contract from "../../shared/api-contract.json";

export const apiContract = contract;
export const API_VERSION: string = contract.api_version;
export const CONTRACT_NAME: string = contract.contract_name;

export type FeatureFlagKey = keyof typeof contract.feature_flags;
export type FeatureAssignments = Partial<Record<FeatureFlagKey, string>>;

export default contract;
