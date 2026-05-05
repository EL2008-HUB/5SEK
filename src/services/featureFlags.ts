import { FeatureAssignments, apiContract } from "../contracts/api";

const defaultAssignments: FeatureAssignments = {
  duels_v1: "on",
};

let assignments: FeatureAssignments = { ...defaultAssignments };

export function setFeatureAssignments(nextAssignments: FeatureAssignments) {
  assignments = { ...defaultAssignments, ...(nextAssignments || {}) };
}

export function getFeatureAssignments() {
  return assignments;
}

export function isFeatureEnabled(key: keyof typeof apiContract.feature_flags) {
  const value = assignments[key];
  if (!value) return false;
  return value !== "control" && value !== "off";
}
