import { normalizeProductSpec } from '@lbdudc/linea-core';

export const trialSpecOf = ({ sample, features = [] }) => {
  const given = sample && typeof sample === 'object' && !Array.isArray(sample) ? sample : {};
  const basicData = given.basicData && typeof given.basicData === 'object' ? given.basicData : {};
  return normalizeProductSpec({ spec: { ...given, basicData: { name: 'trial', version: '0.0.0', ...basicData }, features: [...new Set(features)] } });
};
