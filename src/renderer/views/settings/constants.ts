export const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'siliconflow'] as const;

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  siliconflow: 'SiliconFlow',
};

export const MODELS_BY_PROVIDER: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250901', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  siliconflow: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen3-235B-A22B', 'Qwen/Qwen2.5-72B-Instruct'],
};

export const WORKFLOW_KEYS = ['discover', 'analyze', 'synthesize', 'article', 'agent', 'vision'] as const;

export const PUBLISHER_REGISTRY: Array<{ name: string; doiPrefixes: string[]; domains: string[] }> = [
  { name: 'IEEE', doiPrefixes: ['10.1109'], domains: ['ieeexplore.ieee.org'] },
  { name: 'Elsevier / ScienceDirect', doiPrefixes: ['10.1016'], domains: ['sciencedirect.com', 'cell.com'] },
  { name: 'Springer', doiPrefixes: ['10.1007'], domains: ['link.springer.com'] },
  { name: 'Nature', doiPrefixes: ['10.1038'], domains: ['nature.com'] },
  { name: 'Wiley', doiPrefixes: ['10.1002', '10.1111'], domains: ['onlinelibrary.wiley.com'] },
  { name: 'Taylor & Francis', doiPrefixes: ['10.1080', '10.1081'], domains: ['tandfonline.com'] },
  { name: 'ACS', doiPrefixes: ['10.1021'], domains: ['pubs.acs.org'] },
  { name: 'RSC', doiPrefixes: ['10.1039'], domains: ['pubs.rsc.org'] },
  { name: 'SAGE', doiPrefixes: ['10.1177'], domains: ['journals.sagepub.com'] },
  { name: 'Cambridge University Press', doiPrefixes: ['10.1017'], domains: ['cambridge.org'] },
  { name: 'Oxford University Press', doiPrefixes: ['10.1093'], domains: ['academic.oup.com'] },
  { name: 'MDPI', doiPrefixes: ['10.3390'], domains: ['mdpi.com'] },
  { name: 'ACM', doiPrefixes: ['10.1145'], domains: ['dl.acm.org'] },
  { name: 'APS (Physical Review)', doiPrefixes: ['10.1103'], domains: ['journals.aps.org'] },
  { name: 'AIP', doiPrefixes: ['10.1063'], domains: ['pubs.aip.org'] },
  { name: 'IOP', doiPrefixes: ['10.1088'], domains: ['iopscience.iop.org'] },
  { name: 'De Gruyter', doiPrefixes: ['10.1515'], domains: ['degruyter.com'] },
  { name: 'PNAS', doiPrefixes: ['10.1073'], domains: ['pnas.org'] },
  { name: 'Science (AAAS)', doiPrefixes: ['10.1126'], domains: ['science.org'] },
  { name: 'U. of Chicago Press', doiPrefixes: ['10.1086'], domains: ['journals.uchicago.edu'] },
  { name: 'Wolters Kluwer / LWW', doiPrefixes: ['10.1097'], domains: ['journals.lww.com'] },
  { name: 'Annual Reviews', doiPrefixes: ['10.1146'], domains: ['annualreviews.org'] },
  { name: 'Thieme', doiPrefixes: ['10.1055'], domains: ['thieme-connect.com'] },
  { name: 'Karger', doiPrefixes: ['10.1159'], domains: ['karger.com'] },
  { name: 'BMJ', doiPrefixes: ['10.1136'], domains: ['bmj.com'] },
  { name: 'Mary Ann Liebert', doiPrefixes: ['10.1089'], domains: ['liebertpub.com'] },
  { name: 'Emerald', doiPrefixes: ['10.1108'], domains: ['emerald.com'] },
  { name: 'JSTOR', doiPrefixes: ['10.2307'], domains: ['jstor.org'] },
  { name: 'Routledge', doiPrefixes: ['10.4324'], domains: ['taylorfrancis.com'] },
  { name: 'World Scientific', doiPrefixes: ['10.1142'], domains: ['worldscientific.com'] },
  { name: 'ASCE', doiPrefixes: ['10.1061'], domains: ['ascelibrary.org'] },
  { name: 'ASME', doiPrefixes: ['10.1115'], domains: ['asmedigitalcollection.asme.org'] },
  { name: 'Sciendo', doiPrefixes: ['10.2478'], domains: ['sciendo.com'] },
  { name: 'SPIE', doiPrefixes: ['10.1117'], domains: ['spiedigitallibrary.org'] },
];
